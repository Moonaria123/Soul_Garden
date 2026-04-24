// ============================================================
// Route Handler: LLM Chat Completions Proxy (SU-ITER-028)
// Unified proxy that normalizes OpenAI & Anthropic into
// OpenAI-compatible SSE stream. Bypasses CORS for all providers.
// API Key only lives in the request body — never persisted.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z, type ZodError } from 'zod';
import {
  isUrlSafe,
  isAzureOpenAiHost,
  buildAzureOpenAiChatCompletionsUrl,
  buildOpenAiCompatibleChatCompletionsUrl,
} from '@/lib/llm/upstream-url';
import { normalizeApiKeySecret } from '@/lib/llm/api-key';
import { localhostGuard } from '@/lib/security/localhost-guard';
import {
  safeUpstreamFetch,
  SafeUpstreamError,
} from '@/lib/security/safe-upstream-fetch';
import { SseLineBuffer } from '@/lib/llm/sse-line-buffer';
import {
  buildChatPayload,
  collectChatPayloadWarnings,
  detectProviderProfile,
  type LlmWarning,
} from '@/lib/llm/chat-payload';
import { runOpenAiToolLoop } from '@/lib/llm/tool-loop-openai';
import { runAnthropicToolLoop } from '@/lib/llm/tool-loop-anthropic';
import { buildWebSearchSystemPromptAddition } from '@/lib/llm/web-search-tool';
import type { ThinkingDepth } from '@/types';

// ============================================================
// SU-ITER-090a · P2-05 — request-size hard caps.
//
// Prior state: the route accepted `messages[]` of unbounded length and
// content, allowing a malicious / buggy client to blow past memory or
// upstream-provider quotas by posting millions of characters.  The
// upstream would usually reject, but by then we had already spent
// bandwidth and built a huge JSON blob server-side.
//
// New contract: validate shape + size via Zod BEFORE any upstream call.
//   - Arrays over MAX_MESSAGES → 413 Payload Too Large
//   - A single content over MAX_MESSAGE_LENGTH → 413
//   - Any other shape / enum violation → 400 Bad Request
//
// Limits are intentionally generous; the goal is to stop pathological
// traffic, not to constrain normal multi-turn chats.
// ============================================================
export const MAX_MESSAGES = 200;
export const MAX_MESSAGE_LENGTH = 100_000;

// SU-ITER-090a mini-Gate NIT — upstream providers occasionally echo the
// incoming `Authorization` / `x-api-key` header back in their own error
// response body (seen in older Azure + a few self-hosted OpenAI-
// compatible proxies).  Passing that through verbatim would leak the
// key to the browser.  In production we collapse the body to a generic
// message; in development we keep the truncated preview because it is
// invaluable for debugging and the dev already has the key in hand.
function sanitizeUpstreamErrorBody(text: string): string {
  if (process.env.NODE_ENV === 'production') return '';
  return text.slice(0, 500);
}

// SU-ITER-091-batch2 · P3-05 — the upstream `role` is protocol-level
// metadata; OpenAI/Anthropic/OpenAI-compatible all accept only
// `user`, `assistant`, `system` (plus `tool`, which this route does
// not support).  Previously we accepted `z.string().min(1).max(32)`
// and forwarded unknown roles verbatim, which meant a client bug
// could inject `{ role: 'foo', content }` and the upstream would
// reject it with an opaque 400 blamed on this proxy.  The narrow
// enum below rejects unknown roles at the edge with
// `{ error: 'invalid_body', fields: ['messages.<n>.role'] }` so
// callers immediately see which message is malformed.
const ChatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(MAX_MESSAGE_LENGTH),
  })
  .strict();

// SU-ITER-093 — capability flags threaded through so the proxy can
// translate them into vendor-specific fields via `buildChatPayload`.
// All fields are optional to preserve backward compatibility with any
// older client still posting the minimal envelope.
const ThinkingDepthSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export const ChatRequestSchema = z
  .object({
    baseUrl: z.string().min(1).max(2048),
    apiKey: z.string().min(1).max(8192),
    apiType: z.enum(['openai', 'anthropic', 'openai-compatible']),
    model: z.string().min(1).max(256),
    messages: z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    thinkingEnabled: z.boolean().optional(),
    thinkingDepth: ThinkingDepthSchema.optional(),
    thinkingBudget: z.number().int().min(0).max(65536).optional(),
    visionEnabled: z.boolean().optional(),
    webSearchEnabled: z.boolean().optional(),
    // SU-ITER-094 · P0-2/Phase-B — search orchestration context.
    //
    // Historical state: `webSearchEnabled` meant "inject whatever native
    // web-search parameters the provider profile happens to support".
    // That silently ignored the user's Network Search Tool choice (Brave
    // / Firecrawl / LLM-native) in the settings page — every chat call
    // behaved as if `llm-native` was selected.
    //
    // New contract: when `searchTool !== 'llm-native'`, the proxy MUST
    // strip native web-search fields (handled in Phase C) and execute a
    // tool-calling loop using the supplied credentials.  Here we only
    // declare the envelope so the route reliably accepts the richer
    // payload; Phase C wires the behaviour.
    //
    // All fields optional for backward compatibility.
    searchTool: z.enum(['llm-native', 'brave', 'firecrawl']).optional(),
    searchToolApiKey: z.string().min(1).max(8192).optional(),
    searchToolBaseUrl: z.string().min(1).max(2048).optional(),
    // Whitelist is user-authored; bound its size defensively so a bug
    // in the UI can't DOS the route with a million entries.
    searchWhitelist: z.array(z.string().min(1).max(512)).max(1024).optional(),
    // Range matches the UI slider in search-config panel; default 3.
    maxToolIterations: z.number().int().min(1).max(10).optional(),
  })
  .strict();

type ChatRequest = z.infer<typeof ChatRequestSchema>;

function isTooBigError(err: ZodError): boolean {
  return err.issues.some((i) => i.code === 'too_big');
}

function chatValidationErrorResponse(err: ZodError): NextResponse {
  // Surface field paths only; never echo user-supplied values back in
  // error payloads (they may contain secrets like API keys).
  const fields = err.issues.map((i) => i.path.join('.') || '(root)');
  const status = isTooBigError(err) ? 413 : 400;
  console.warn(
    `[llm-chat] validation failed status=${status} fields=${fields.join(',')}`,
  );
  return NextResponse.json(
    {
      error:
        status === 413
          ? 'Request exceeds size limits'
          : 'Invalid request payload',
      fields,
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return chatValidationErrorResponse(parsed.error);
  }
  const body: ChatRequest = parsed.data;

  const {
    baseUrl,
    apiType,
    model,
    messages,
    temperature = 0.8,
    stream = true,
    thinkingEnabled,
    thinkingDepth,
    thinkingBudget,
    visionEnabled,
    webSearchEnabled,
    searchTool,
    searchToolApiKey,
    searchToolBaseUrl,
    searchWhitelist,
    maxToolIterations,
  } = body;
  const apiKey = normalizeApiKeySecret(body.apiKey);
  const capabilityFlags = {
    thinkingEnabled,
    thinkingDepth,
    thinkingBudget,
    visionEnabled,
    webSearchEnabled,
  };
  // SU-ITER-094 · Phase-B — carry the chosen search tool + credentials
  // forward to the handlers.  Phase C will consume these to run the
  // tool-calling loop; Phase B only guarantees the envelope reaches the
  // handler without a schema / destructuring gap.
  const searchContext: SearchContext = {
    searchTool,
    searchToolApiKey: searchToolApiKey ? normalizeApiKeySecret(searchToolApiKey) : undefined,
    searchToolBaseUrl,
    searchWhitelist,
    maxToolIterations,
  };

  // `apiKey` may be normalised away to empty — treat that as 400.
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!isUrlSafe(baseUrl)) {
    return NextResponse.json({ error: 'URL blocked by security policy' }, { status: 403 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2min for long generations

  try {
    if (apiType === 'anthropic') {
      return await handleAnthropic({
        baseUrl, apiKey, apiType, model, messages, temperature, stream,
        controller, ...capabilityFlags, ...searchContext,
      });
    }
    return await handleOpenAI({
      baseUrl, apiKey, apiType, model, messages, temperature, stream,
      controller, ...capabilityFlags, ...searchContext,
    });
  } catch (e: unknown) {
    // SU-ITER-089 · P1-4 — surface the SSRF guard's 403 verdict distinctly
    // from other upstream failures so ops dashboards can alert on it.
    if (e instanceof SafeUpstreamError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'Chat request failed';
    if (msg.includes('aborted')) {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 });
    }
    // SU-ITER-092-batch3 · Nit cleanup — never leak upstream error bodies to
    // the client in production; they may carry provider-side stack snippets,
    // internal URLs, or partial secrets.  Dev keeps the raw `msg` to make
    // provider/network debugging ergonomic.
    const detail = process.env.NODE_ENV === 'production' ? 'upstream_error' : msg;
    return NextResponse.json({ error: detail }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

// --- OpenAI / OpenAI-compatible ---

type ChatRole = z.infer<typeof ChatMessageSchema>['role'];

interface CapabilityFlags {
  thinkingEnabled?: boolean;
  thinkingDepth?: ThinkingDepth;
  thinkingBudget?: number;
  visionEnabled?: boolean;
  webSearchEnabled?: boolean;
}

// SU-ITER-094 · Phase-B — search tool routing context.  The envelope
// is accepted today; Phase C wires execution.  Kept as a dedicated
// interface so the tool-loop implementation can type-narrow on
// `searchTool !== 'llm-native'` without leaking strings into handlers
// that don't care yet.
interface SearchContext {
  searchTool?: 'llm-native' | 'brave' | 'firecrawl';
  searchToolApiKey?: string;
  searchToolBaseUrl?: string;
  searchWhitelist?: string[];
  maxToolIterations?: number;
}

interface HandlerOpts extends CapabilityFlags, SearchContext {
  baseUrl: string;
  apiKey: string;
  apiType: 'openai' | 'anthropic' | 'openai-compatible';
  model: string;
  messages: { role: ChatRole; content: string }[];
  temperature: number;
  stream: boolean;
  controller: AbortController;
}

// SU-ITER-096 · Bug B-3 — serialise LlmWarning[] into response
// headers so the browser transport can surface the soft-degrade
// via toast.info.  We only emit the first warning because the
// current spec only has one code (web_search.unsupported_sku);
// a repeated header list would complicate the client parser for
// no user-visible benefit.
function buildWarningHeaders(warnings: LlmWarning[]): Record<string, string> {
  if (warnings.length === 0) return {};
  const first = warnings[0];
  return {
    'x-su-warning-web-search': first.code,
    'x-su-warning-web-search-model': first.model,
  };
}

async function handleOpenAI(opts: HandlerOpts) {
  // SU-ITER-094 · Phase-C — when the user selected a non-native
  // search tool AND provided a key, divert to the function-calling
  // tool loop. This path emits OpenAI-compatible SSE synthesised
  // from the final assistant message, so the browser parser does
  // not need provider branches.
  if (
    opts.searchTool &&
    opts.searchTool !== 'llm-native' &&
    opts.searchToolApiKey
  ) {
    return runOpenAiToolLoop({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      apiType: opts.apiType,
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      thinkingEnabled: opts.thinkingEnabled,
      thinkingDepth: opts.thinkingDepth,
      thinkingBudget: opts.thinkingBudget,
      visionEnabled: opts.visionEnabled,
      maxIterations: opts.maxToolIterations ?? 3,
      systemPromptPrefix: buildWebSearchSystemPromptAddition(
        opts.searchTool,
        opts.searchWhitelist ?? [],
      ),
      toolContext: {
        searchTool: opts.searchTool,
        apiKey: opts.searchToolApiKey,
        baseUrl: opts.searchToolBaseUrl,
        whitelist: opts.searchWhitelist ?? [],
      },
      controller: opts.controller,
    });
  }

  const url = isAzureOpenAiHost(opts.baseUrl)
    ? buildAzureOpenAiChatCompletionsUrl(opts.baseUrl, opts.model)
    : buildOpenAiCompatibleChatCompletionsUrl(opts.baseUrl);

  const headerAuth: Record<string, string> = isAzureOpenAiHost(opts.baseUrl)
    ? { 'api-key': opts.apiKey }
    : { 'Authorization': `Bearer ${opts.apiKey}` };

  // SU-ITER-093 — translate capability flags to profile-correct field
  // names (reasoning_effort / web_search_options for OpenAI, thinking /
  // tools for Claude-via-gateway, enable_thinking for DashScope).
  const profile = detectProviderProfile(opts.baseUrl, opts.apiType);
  const payload = buildChatPayload({
    profile,
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    stream: opts.stream,
    thinkingEnabled: opts.thinkingEnabled,
    thinkingDepth: opts.thinkingDepth,
    thinkingBudget: opts.thinkingBudget,
    visionEnabled: opts.visionEnabled,
    webSearchEnabled: opts.webSearchEnabled,
  });

  // SU-ITER-096 · Bug B-3 — collect soft-degrade warnings so the
  // browser can toast the user when a capability flag silently
  // dropped off the payload (e.g. webSearch on gpt-4o).
  const warnings = collectChatPayloadWarnings({
    profile,
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    stream: opts.stream,
    webSearchEnabled: opts.webSearchEnabled,
  });

  // SU-ITER-089 · P1-4 — manual redirect + Location allow-list so a
  // public baseUrl cannot 302 us at an internal service.
  const res = await safeUpstreamFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headerAuth,
    },
    body: JSON.stringify(payload),
    signal: opts.controller.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const preview = sanitizeUpstreamErrorBody(text);
    return NextResponse.json(
      {
        error: preview
          ? `Upstream error (${res.status}): ${preview}`
          : `Upstream error (${res.status})`,
      },
      { status: res.status }
    );
  }

  if (!opts.stream || !res.body) {
    const data = await res.json();
    return NextResponse.json(data, { headers: buildWarningHeaders(warnings) });
  }

  // Pass through OpenAI SSE directly
  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...buildWarningHeaders(warnings),
    },
  });
}

// --- Anthropic ---

async function handleAnthropic(opts: HandlerOpts) {
  // SU-ITER-094 · Phase-C — same divert as handleOpenAI, routed to
  // the Anthropic tool-use loop instead.
  if (
    opts.searchTool &&
    opts.searchTool !== 'llm-native' &&
    opts.searchToolApiKey
  ) {
    return runAnthropicToolLoop({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      thinkingEnabled: opts.thinkingEnabled,
      thinkingDepth: opts.thinkingDepth,
      thinkingBudget: opts.thinkingBudget,
      maxIterations: opts.maxToolIterations ?? 3,
      systemPromptPrefix: buildWebSearchSystemPromptAddition(
        opts.searchTool,
        opts.searchWhitelist ?? [],
      ),
      toolContext: {
        searchTool: opts.searchTool,
        apiKey: opts.searchToolApiKey,
        baseUrl: opts.searchToolBaseUrl,
        whitelist: opts.searchWhitelist ?? [],
      },
      controller: opts.controller,
    });
  }

  const base = opts.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1')
    ? `${base}/messages`
    : `${base}/v1/messages`;

  // Extract system message (Anthropic uses a separate `system` field)
  const systemMsg = opts.messages.find((m) => m.role === 'system');

  // SU-ITER-093 — delegate body shape (including thinking / tools) to
  // the profile-aware builder so thinking is enforced with the correct
  // budget_tokens and max_tokens headroom whenever the user asks for it.
  const anthropicBody = buildChatPayload({
    profile: 'anthropic',
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    stream: opts.stream,
    thinkingEnabled: opts.thinkingEnabled,
    thinkingDepth: opts.thinkingDepth,
    thinkingBudget: opts.thinkingBudget,
    visionEnabled: opts.visionEnabled,
    webSearchEnabled: opts.webSearchEnabled,
    anthropicSystem: systemMsg?.content,
  });

  // SU-ITER-096 · Bug B-2 — Anthropic's web-search tool requires
  // BOTH `tools: [{type: 'web_search_20250305'}]` in the body AND
  // the beta opt-in header.  `buildChatPayload` already emits the
  // tool when `webSearchEnabled` is true; we add the header
  // **only** when the body actually carries the tool so a plain
  // turn (webSearch off) keeps the original header set.
  const anthropicTools = Array.isArray(anthropicBody.tools)
    ? (anthropicBody.tools as Array<{ type?: string }>)
    : [];
  const hasWebSearchTool = anthropicTools.some(
    (tool) => tool?.type === 'web_search_20250305',
  );
  const anthropicHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': opts.apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (hasWebSearchTool) {
    anthropicHeaders['anthropic-beta'] = 'web-search-2025-03-05';
  }

  // SU-ITER-089 · P1-4 — same SSRF guard as the OpenAI path.
  const res = await safeUpstreamFetch(url, {
    method: 'POST',
    headers: anthropicHeaders,
    body: JSON.stringify(anthropicBody),
    signal: opts.controller.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const preview = sanitizeUpstreamErrorBody(text);
    return NextResponse.json(
      {
        error: preview
          ? `Anthropic error (${res.status}): ${preview}`
          : `Anthropic error (${res.status})`,
      },
      { status: res.status }
    );
  }

  if (!opts.stream || !res.body) {
    // Non-streaming: convert Anthropic response to OpenAI format
    const data = await res.json();
    const content = data.content?.map((b: { text?: string }) => b.text || '').join('') || '';
    return NextResponse.json(
      {
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      },
      {
        headers: buildWarningHeaders(
          collectChatPayloadWarnings({
            profile: 'anthropic',
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            stream: opts.stream,
            webSearchEnabled: opts.webSearchEnabled,
          }),
        ),
      },
    );
  }

  // Streaming: transform Anthropic SSE → OpenAI SSE
  const reader = res.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // SU-ITER-089 · P1-8 — buffer partial lines across chunk boundaries
  // so a `content_block_delta` event that spans two network reads is
  // still parsed as a single JSON event.
  const lineBuf = new SseLineBuffer();

  const transformed = new ReadableStream({
    async pull(controller) {
      const processLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) return false;
        try {
          const event = JSON.parse(trimmed.slice(6));
          if (event.type === 'content_block_delta' && event.delta?.text) {
            const openaiChunk = {
              choices: [{
                delta: { content: event.delta.text },
                index: 0,
              }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
          } else if (event.type === 'message_stop') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return true; // signal close
          }
        } catch {
          // Skip non-JSON lines
        }
        return false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Drain decoder + buffer before closing so a final event
          // that arrived without a terminating newline is not lost.
          for (const line of lineBuf.feed(decoder.decode())) {
            if (processLine(line)) return;
          }
          const tail = lineBuf.flush();
          if (tail !== null && processLine(tail)) return;
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        for (const line of lineBuf.feed(chunk)) {
          if (processLine(line)) return;
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(transformed, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...buildWarningHeaders(
        collectChatPayloadWarnings({
          profile: 'anthropic',
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature,
          stream: opts.stream,
          webSearchEnabled: opts.webSearchEnabled,
        }),
      ),
    },
  });
}
