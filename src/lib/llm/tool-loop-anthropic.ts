// ============================================================
// Anthropic Claude tool-use loop (SU-ITER-094 · Phase-C — P1-4)
//
// Same contract as tool-loop-openai.ts, but speaking Anthropic's
// native `tool_use` / `tool_result` content-block protocol instead
// of OpenAI's `tool_calls` / role=`tool` message protocol.
//
// Anthropic's message shape differs from OpenAI's in two important
// ways we must respect:
//
//   1. Assistant messages with tool_use are returned as an ARRAY of
//      content blocks (`[{type:'text',text:...}, {type:'tool_use', id, name, input}]`).
//      That exact array must be echoed back to the API on the next
//      round so the `tool_use_id` references resolve.
//
//   2. Tool results are posted back as a `user` message whose
//      content is an array of `tool_result` blocks, NOT as a
//      dedicated `tool` role (which Anthropic does not have).
//
// We translate Anthropic's final assistant text to OpenAI-compatible
// SSE on the way out so the browser parser (`callLLMDirect`) does
// not need a per-provider branch.
// ============================================================

import type { NextResponse } from 'next/server';
import { safeUpstreamFetch } from '@/lib/security/safe-upstream-fetch';
import {
  WEB_SEARCH_TOOL_DEFS_ANTHROPIC,
  executeWebSearchTool,
  type WebSearchToolContext,
} from '@/lib/llm/web-search-tool';
import { defaultBudgetForDepth } from '@/lib/llm/chat-payload';
import type { ThinkingDepth } from '@/types';

// ---------- Types ----------

export interface AnthropicToolLoopOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature: number;
  thinkingEnabled?: boolean;
  thinkingDepth?: ThinkingDepth;
  thinkingBudget?: number;
  maxIterations: number;
  systemPromptPrefix: string;
  toolContext: WebSearchToolContext;
  controller: AbortController;
}

// Anthropic content block shapes (only what we read / emit).
type AnthTextBlock = { type: 'text'; text: string };
type AnthToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
};
type AnthContentBlock = AnthTextBlock | AnthToolUseBlock | AnthToolResultBlock;

// Message shape we append to the evolving conversation.
type AnthMessage =
  | { role: 'user'; content: string | AnthToolResultBlock[] }
  | { role: 'assistant'; content: AnthContentBlock[] | string };

interface AnthropicResponse {
  content?: AnthContentBlock[];
  stop_reason?: string;
}

// ---------- Entry point ----------

export async function runAnthropicToolLoop(
  opts: AnthropicToolLoopOpts,
): Promise<Response | NextResponse> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1')
    ? `${base}/messages`
    : `${base}/v1/messages`;

  // Anthropic uses a dedicated top-level `system` field; pull it out
  // of the messages array and prepend our tool-usage prefix.
  const systemFromMsg = opts.messages.find((m) => m.role === 'system')?.content ?? '';
  const systemCombined = opts.systemPromptPrefix
    ? systemFromMsg
      ? `${opts.systemPromptPrefix}\n\n${systemFromMsg}`
      : opts.systemPromptPrefix
    : systemFromMsg;

  // Evolving conversation minus the system message — starts as
  // plain text messages from the client, gains tool_use /
  // tool_result blocks as iterations proceed.
  const conversation: AnthMessage[] = opts.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  let finalText = '';
  let lastStopReason = 'end_turn';

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: conversation,
      max_tokens: 8192,
      temperature: opts.temperature,
      stream: false,
      tools: WEB_SEARCH_TOOL_DEFS_ANTHROPIC,
    };
    if (systemCombined) body.system = systemCombined;

    // Same thinking logic as buildAnthropicBody — duplicated here
    // rather than round-tripping through buildChatPayload because
    // that helper does not expose the evolving `conversation`
    // shape (array of content blocks).
    if (opts.thinkingEnabled && opts.thinkingDepth !== 'off') {
      const budget = Math.max(
        opts.thinkingBudget ?? defaultBudgetForDepth(opts.thinkingDepth),
        1024,
      );
      body.thinking = { type: 'enabled', budget_tokens: budget };
      body.max_tokens = Math.max(budget + 1024, 8192);
    }

    const res = await safeUpstreamFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return errorSse(
        `Anthropic error (${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`,
      );
    }

    const data = (await res.json()) as AnthropicResponse;
    const blocks = data.content ?? [];
    lastStopReason = data.stop_reason ?? 'end_turn';

    const toolUseBlocks = blocks.filter(
      (b): b is AnthToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      finalText = blocks
        .filter((b): b is AnthTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      break;
    }

    // Echo the assistant turn (text + tool_use blocks) verbatim;
    // Anthropic refuses to resolve tool_use_id otherwise.
    conversation.push({ role: 'assistant', content: blocks });

    // Dispatch each tool_use, collect results into a user message.
    const resultBlocks: AnthToolResultBlock[] = [];
    for (const tu of toolUseBlocks) {
      const result = await executeWebSearchTool(
        tu.name,
        tu.input,
        opts.toolContext,
      );
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: result.content,
      });
    }
    conversation.push({ role: 'user', content: resultBlocks });
  }

  if (!finalText && lastStopReason !== 'end_turn') {
    finalText = [
      '(Web-search tool loop reached the configured iteration cap',
      `(${opts.maxIterations}) without producing a final answer.`,
      'You can raise the cap in Settings → Network Search Tools.)',
    ].join(' ');
  }

  return sseResponse(finalText);
}

// ---------- Shared SSE emitter (OpenAI-format) ----------

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      if (text) {
        const chunk = {
          choices: [
            { delta: { content: text }, index: 0, finish_reason: null },
          ],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      const stopChunk = {
        choices: [
          { delta: {}, index: 0, finish_reason: 'stop' },
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
  return sseResponse(`⚠️ ${message}`);
}
