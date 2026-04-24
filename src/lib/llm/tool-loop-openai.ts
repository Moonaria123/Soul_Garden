// ============================================================
// OpenAI / OpenAI-compatible function-calling tool loop
// (SU-ITER-094 · Phase-C — P1-4)
//
// Contract
// --------
// When the chat proxy detects a non-native search tool selection
// (`searchTool` ∈ { 'brave', 'firecrawl' }), the normal
// "fetch → pipe SSE → client" flow is replaced by this loop:
//
//   1. Call upstream with `stream: false` + our unified `tools`
//      schema from web-search-tool.ts.
//   2. If the upstream returned `tool_calls`, dispatch each call
//      through `executeWebSearchTool`, append the results as
//      role=`tool` messages, and iterate.
//   3. When upstream finally returns plain `content`, synthesise
//      a minimal OpenAI-compatible SSE stream so the browser's
//      existing parser (`callLLMDirect`) keeps working without
//      modification.
//
// Why non-streaming upstream in tool-loop mode?
// ---------------------------------------------
// Parsing streamed `tool_calls` deltas is doable but fragile —
// OpenAI splits function arguments across many chunks, and each
// gateway (Poe/OpenRouter/DeepSeek/etc.) reshapes the stream a
// bit differently. Doing one non-streaming round-trip per
// iteration is simpler, deterministic, and keeps the total
// latency in the same ballpark because tool calls inherently
// block on external HTTP anyway.
// ============================================================

import type { NextResponse } from 'next/server';
import {
  isAzureOpenAiHost,
  buildAzureOpenAiChatCompletionsUrl,
  buildOpenAiCompatibleChatCompletionsUrl,
} from '@/lib/llm/upstream-url';
import { safeUpstreamFetch } from '@/lib/security/safe-upstream-fetch';
import {
  buildChatPayload,
  detectProviderProfile,
  type ProviderProfile,
} from '@/lib/llm/chat-payload';
import {
  WEB_SEARCH_TOOL_DEFS_OPENAI,
  executeWebSearchTool,
  type WebSearchToolContext,
} from '@/lib/llm/web-search-tool';
import type { ApiType, ThinkingDepth } from '@/types';

// ---------- Types ----------

export interface OpenAiToolLoopOpts {
  baseUrl: string;
  apiKey: string;
  apiType: ApiType;
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature: number;
  thinkingEnabled?: boolean;
  thinkingDepth?: ThinkingDepth;
  thinkingBudget?: number;
  visionEnabled?: boolean;
  /** Max iterations of the tool-call loop (user-configurable, 1-10). */
  maxIterations: number;
  /** Prefixed onto the system message so the model knows when/how
   *  to use the tools — see `buildWebSearchSystemPromptAddition`. */
  systemPromptPrefix: string;
  /** Whitelist + credentials for `executeWebSearchTool`. */
  toolContext: WebSearchToolContext;
  controller: AbortController;
}

// ---------- Minimal OpenAI response shape ----------
//
// We only depend on the fields we actually read; everything else is
// passed through verbatim via JSON serialisation. This keeps the
// loop resilient to gateway variations that add custom fields.

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: OpenAiAssistantMessage;
    finish_reason?: string;
  }>;
}

// Loose internal message shape so we can append tool-role messages
// that are never exposed to the outer schema.
type LooseMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

// ---------- Entry point ----------

export async function runOpenAiToolLoop(
  opts: OpenAiToolLoopOpts,
): Promise<Response | NextResponse> {
  const url = isAzureOpenAiHost(opts.baseUrl)
    ? buildAzureOpenAiChatCompletionsUrl(opts.baseUrl, opts.model)
    : buildOpenAiCompatibleChatCompletionsUrl(opts.baseUrl);

  const headerAuth: Record<string, string> = isAzureOpenAiHost(opts.baseUrl)
    ? { 'api-key': opts.apiKey }
    : { 'Authorization': `Bearer ${opts.apiKey}` };

  const profile: ProviderProfile = detectProviderProfile(opts.baseUrl, opts.apiType);

  // Inject the tool-usage technical prompt into the system message.
  // If a system message already exists we PREFIX the addition so the
  // persona's voice (which typically lives at the end of the system
  // prompt) still reads naturally.
  const messages: LooseMessage[] = injectSystemPrefix(
    opts.messages,
    opts.systemPromptPrefix,
  );

  let finalText = '';
  let lastFinishReason = 'stop';

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    // SU-ITER-094 · Phase-C — build base body with webSearchEnabled
    // forced OFF, so no vendor-native web-search fields sneak in
    // alongside our function-calling schema.
    const baseBody = buildChatPayload({
      profile,
      model: opts.model,
      messages: messages.filter(
        (m): m is { role: 'user' | 'assistant' | 'system'; content: string } =>
          (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
          typeof (m as { content?: unknown }).content === 'string',
      ),
      temperature: opts.temperature,
      stream: false,
      thinkingEnabled: opts.thinkingEnabled,
      thinkingDepth: opts.thinkingDepth,
      thinkingBudget: opts.thinkingBudget,
      visionEnabled: opts.visionEnabled,
      webSearchEnabled: false,
    });

    // Override `messages` with the looser shape (which may contain
    // `tool_calls` / `tool` rows) and attach our tools schema.
    const body: Record<string, unknown> = {
      ...baseBody,
      messages,
      tools: WEB_SEARCH_TOOL_DEFS_OPENAI,
      // `auto` lets the model decide; matches FC#2 = C's "智能决定".
      tool_choice: 'auto',
    };

    const res = await safeUpstreamFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headerAuth,
      },
      body: JSON.stringify(body),
      signal: opts.controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return errorSse(
        `Upstream error (${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`,
      );
    }

    const data = (await res.json()) as OpenAiChatResponse;
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;
    lastFinishReason = choice?.finish_reason ?? 'stop';

    if (!assistantMsg) {
      return errorSse('Upstream returned an empty response');
    }

    const toolCalls = assistantMsg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      // Plain textual answer — we're done.
      finalText = assistantMsg.content ?? '';
      break;
    }

    // Record the assistant turn that carries the tool_calls; the
    // upstream REQUIRES seeing this exact shape echoed back on the
    // next round so it can resolve tool_call_id references.
    messages.push({
      role: 'assistant',
      content: assistantMsg.content ?? null,
      tool_calls: toolCalls,
    });

    // Dispatch every tool call, in order. We intentionally do NOT
    // parallelise: a `fetch_url` called right after a `web_search`
    // is a common pattern, and running them sequentially keeps the
    // model's reasoning trace straightforward.
    for (const tc of toolCalls) {
      let parsed: unknown = {};
      try {
        parsed = tc.function.arguments
          ? JSON.parse(tc.function.arguments)
          : {};
      } catch {
        // Malformed arguments — let the executor surface the error
        // as a structured tool_result so the model can retry.
      }
      const result = await executeWebSearchTool(
        tc.function.name,
        parsed,
        opts.toolContext,
      );
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result.content,
      });
    }
    // Loop continues for another upstream round-trip.
  }

  if (!finalText && lastFinishReason !== 'stop') {
    // Iteration cap hit without a textual answer — tell the user.
    finalText = [
      '(Web-search tool loop reached the configured iteration cap',
      `(${opts.maxIterations}) without producing a final answer.`,
      'You can raise the cap in Settings → Network Search Tools.)',
    ].join(' ');
  }

  return sseResponse(finalText, lastFinishReason);
}

// ---------- Helpers ----------

function injectSystemPrefix(
  messages: OpenAiToolLoopOpts['messages'],
  prefix: string,
): LooseMessage[] {
  if (!prefix) return [...messages];
  const idx = messages.findIndex((m) => m.role === 'system');
  if (idx === -1) {
    return [{ role: 'system', content: prefix }, ...messages];
  }
  const next: LooseMessage[] = messages.map((m, i) =>
    i === idx
      ? { role: 'system' as const, content: `${prefix}\n\n${m.content}` }
      : m,
  );
  return next;
}

/**
 * Emit a single SSE chunk carrying the full assistant text followed
 * by `[DONE]`. The browser's callLLMDirect parser accepts any number
 * of deltas so a single chunk is legal and simplest.
 */
function sseResponse(text: string, finishReason: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      if (text) {
        const chunk = {
          choices: [
            {
              delta: { content: text },
              index: 0,
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      const stopChunk = {
        choices: [
          { delta: {}, index: 0, finish_reason: finishReason },
        ],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function errorSse(message: string): Response {
  return sseResponse(`⚠️ ${message}`, 'stop');
}
