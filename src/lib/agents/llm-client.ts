'use client';

import type { ApiType, ThinkingDepth } from '@/types';
import { classifyLlmError, type LlmErrorInfo } from '@/lib/llm/llm-error';
import { SseLineBuffer } from '@/lib/llm/sse-line-buffer';

/**
 * SU-088 P0-G: attach a pre-classified LlmErrorInfo onto a thrown Error so
 * upstream `classifyLlmError` calls can short-circuit without re-parsing
 * the message — important for the retry path where the raw Error is caught
 * twice.
 */
function tagLlmError(err: Error, fallbackStatus?: number): Error & LlmErrorInfo {
  const carrier = fallbackStatus !== undefined && !/\b\d{3}\b/.test(err.message)
    ? Object.assign(err, { status: fallbackStatus })
    : err;
  const info = classifyLlmError(carrier);
  return Object.assign(err, info);
}

// ============================================================
// LLM Client (FR-411 / SU-ITER-006 / SU-ITER-028 / SU-ITER-093)
//
// Strategy:
//  - All apiTypes go through the Route Handler proxy at
//    `/api/llm/chat`.  The previous "try direct, fall back on CORS"
//    path violated the app's `connect-src 'self'` CSP whenever the
//    configured baseUrl was a third-party host (Poe, OpenRouter,
//    DashScope, …).  The proxy also isolates API keys from the
//    browser and lets us apply SSRF / timeout / schema guards in
//    one place.
//  - Anthropic SSE is normalised to OpenAI-compatible SSE by the
//    proxy so the reader below stays unified.
// ============================================================

export interface LLMCallOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  thinkingEnabled?: boolean;
  thinkingDepth?: ThinkingDepth;
  thinkingBudget?: number;
  visionEnabled?: boolean;
  webSearchEnabled?: boolean;
  apiType?: ApiType;
  // SU-ITER-094 · Phase-B — search tool routing.  When
  // `webSearchEnabled` is true and `searchTool !== 'llm-native'`, the
  // proxy will (in Phase C) orchestrate a tool-calling loop against
  // the named external search API using these credentials.  A missing
  // `searchTool` keeps the legacy behaviour (native provider search).
  searchTool?: 'llm-native' | 'brave' | 'firecrawl';
  searchToolApiKey?: string;
  searchToolBaseUrl?: string;
  searchWhitelist?: string[];
  maxToolIterations?: number;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: Error) => void;
  /**
   * SU-ITER-096 · Bug B-3 — soft-degrade notification surfaced by
   * the `/api/llm/chat` proxy via response headers.  Currently the
   * only code is `web_search.unsupported_sku`, emitted when the
   * user toggled web search on a model whose provider silently
   * drops the flag (e.g. gpt-4o non search-preview).  Consumers
   * typically render this as a toast and continue the chat.
   */
  onWarning?: (code: string, meta: { model: string }) => void;
}

/**
 * Call an LLM chat completion API. Automatically chooses direct
 * browser fetch or server-side proxy based on apiType.
 *
 * SU-ITER-092-batch2 · AbortSignal threading — if `signal` is provided,
 * it is forwarded to both `fetch` and the SSE reader loop, so aborting
 * the controller actually tears down the in-flight HTTP connection
 * and releases the upstream.  Without this, previous code could only
 * check `signal?.aborted` between LLM calls but never cancel the
 * currently-running request.
 */
export async function callLLMDirect(
  messages: { role: string; content: string }[],
  options: LLMCallOptions,
  callbacks?: StreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  // SU-ITER-093 — every upstream call is funnelled through the server
  // proxy.  Direct browser fetches to third-party LLM hosts are now
  // forbidden by our CSP (`connect-src 'self'`) and the proxy is the
  // only place capability flags are translated into provider-correct
  // request fields.
  return callViaProxy(messages, options, callbacks, signal);
}

/**
 * Non-streaming LLM call (for extraction and summary).
 * Still streams internally but returns the full text.
 *
 * SU-ITER-092-batch2 — accepts optional `signal` so long-running
 * extraction pipelines can cancel the specific in-flight step on
 * user abort instead of waiting for the LLM to finish generating.
 */
export async function callLLMDirectFull(
  messages: { role: string; content: string }[],
  options: LLMCallOptions,
  signal?: AbortSignal
): Promise<string> {
  return callLLMDirect(messages, options, undefined, signal);
}

// --- Proxy call (works for all apiTypes) ---

async function callViaProxy(
  messages: { role: string; content: string }[],
  options: LLMCallOptions,
  callbacks?: StreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: options.baseURL,
      apiKey: options.apiKey,
      apiType: options.apiType ?? 'openai-compatible',
      model: options.model,
      messages,
      temperature: options.temperature ?? 0.8,
      stream: true,
      // SU-ITER-093 — capability flags threaded to the proxy so it can
      // translate them into each vendor's correct field names.  They
      // are all optional; the proxy schema accepts the minimal envelope
      // too for backward compatibility.
      ...(options.thinkingEnabled !== undefined && { thinkingEnabled: options.thinkingEnabled }),
      ...(options.thinkingDepth !== undefined && { thinkingDepth: options.thinkingDepth }),
      ...(options.thinkingBudget !== undefined && { thinkingBudget: options.thinkingBudget }),
      ...(options.visionEnabled !== undefined && { visionEnabled: options.visionEnabled }),
      ...(options.webSearchEnabled !== undefined && { webSearchEnabled: options.webSearchEnabled }),
      // SU-ITER-094 · Phase-B — search tool context pass-through.
      // Conditional spread keeps the proxy payload minimal for the
      // default `llm-native` path and backward-compatible with clients
      // that pre-date this feature.
      ...(options.searchTool !== undefined && { searchTool: options.searchTool }),
      ...(options.searchToolApiKey !== undefined && { searchToolApiKey: options.searchToolApiKey }),
      ...(options.searchToolBaseUrl !== undefined && { searchToolBaseUrl: options.searchToolBaseUrl }),
      ...(options.searchWhitelist !== undefined && { searchWhitelist: options.searchWhitelist }),
      ...(options.maxToolIterations !== undefined && { maxToolIterations: options.maxToolIterations }),
    }),
    signal,
  });

  if (!response.ok) {
    let errorMsg: string;
    try {
      const data = await response.json();
      errorMsg = data.error || `HTTP ${response.status}`;
    } catch {
      errorMsg = `LLM 调用失败 (${response.status})`;
    }
    const error = tagLlmError(new Error(errorMsg), response.status);
    callbacks?.onError?.(error);
    throw error;
  }

  // SU-ITER-096 · inspect soft-degrade warning headers emitted by
  // the proxy.  We intentionally surface this *before* starting to
  // read the SSE body so the toast appears near the start of the
  // response, not after the whole turn has streamed.
  const warningCode = response.headers.get('x-su-warning-web-search');
  if (warningCode && callbacks?.onWarning) {
    const warningModel =
      response.headers.get('x-su-warning-web-search-model') ?? options.model;
    callbacks.onWarning(warningCode, { model: warningModel });
  }

  return readOpenAISSE(response, callbacks, signal);
}

// --- Shared SSE reader (OpenAI format — proxy normalizes Anthropic to this) ---

async function readOpenAISSE(
  response: Response,
  callbacks?: StreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw tagLlmError(new Error('No response body'), 500);

  const decoder = new TextDecoder();
  const lineBuf = new SseLineBuffer();
  let fullText = '';

  /**
   * SU-ITER-089 · P1-8 — processLine is invoked for every COMPLETE
   * SSE line.  Keeping it inline (rather than inlining the old
   * string split) means the byte-chunk boundary no longer decides
   * whether a `data: {...}` event is parseable.
   */
  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') return;
    if (!trimmed.startsWith('data: ')) return;
    try {
      const json = JSON.parse(trimmed.slice(6));
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        callbacks?.onChunk?.(fullText);
      }
    } catch {
      // Non-JSON line, skip
    }
  };

  try {
    while (true) {
      // SU-ITER-092-batch2 · AbortSignal threading — check before every
      // read so a deliberate abort unblocks the reader promptly even if
      // the upstream keeps pushing tokens.  We explicitly cancel the
      // reader so the underlying HTTP stream is torn down.
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('LLM stream aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) {
        // Drain any residual bytes the decoder might still hold, then
        // flush the last (unterminated) line — some providers omit the
        // final `\n\n` before closing.
        const tail = decoder.decode();
        for (const line of lineBuf.feed(tail)) processLine(line);
        const leftover = lineBuf.flush();
        if (leftover !== null) processLine(leftover);
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      for (const line of lineBuf.feed(chunk)) processLine(line);
    }
  } catch (e) {
    // If the `fetch` itself was aborted, `reader.read()` rejects with a
    // DOMException.  Make sure any attached listeners get the abort
    // reason unmodified rather than a vague network error.
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('LLM stream aborted', 'AbortError');
    }
    throw e;
  }

  callbacks?.onDone?.(fullText);
  return fullText;
}
