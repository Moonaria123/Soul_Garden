// ============================================================
// Provider-aware chat payload builder (SU-ITER-093)
//
// Purpose: when a user toggles thinking / vision / webSearch for
// a real chat turn, the feature flags must be translated into
// each vendor's correct field names before hitting upstream.
// This file is the runtime counterpart to capability-probe-profiles.ts
// (which does the same translation for capability probes).
//
// Design decisions:
//   - We REUSE `detectProviderProfile` / `isClaudeModel` /
//     `isAdaptiveModel` from capability-probe-profiles.ts instead
//     of duplicating heuristics.
//   - The builder is provider-dispatching: the caller passes the
//     already-detected profile (the route handler already knows
//     which branch it is in via apiType + host).
//   - Vision payloads ride on the `messages[*].content` shape — the
//     builder does NOT inject any image fields of its own.  This
//     keeps the vision path gated by what the chat UI actually
//     sends (Phase C will open that gate).
//   - `webSearchEnabled: true` on a model whose profile has no
//     web-search field (e.g. a Claude model behind a generic
//     OpenAI gateway) silently omits the field rather than sending
//     something that would 400 — the upstream probe already
//     decided this capability was unsupported, or the UI toast
//     warned the user.
// ============================================================

import {
  detectProviderProfile,
  isClaudeModel,
  type ProviderProfile,
} from '@/lib/llm/capability-probe-profiles';
import type { ApiType, ThinkingDepth } from '@/types';

// Re-export so the route handler only needs one import.
export { detectProviderProfile };
export type { ProviderProfile };

// ----------------------------------------------------------------
// SU-ITER-096 · shared web-search constants
//
// Hoisted so the route handler, the payload builder, and the
// warnings collector all agree on the single source of truth
// for:
//   - the Anthropic tool marker value (`web_search_20250305`),
//   - the regex that identifies OpenAI SKUs which actually
//     honour `web_search_options` (only the
//     `*-search-preview` family at the time of writing).
// Keeping these exported lets the Anthropic native route also
// flip the `anthropic-beta: web-search-2025-03-05` header when
// — and only when — the body carries the tool.
// ----------------------------------------------------------------
export const WEB_SEARCH_TOOL_DEFINITION = { type: 'web_search_20250305' } as const;
export const OPENAI_WEB_SEARCH_SKU_PATTERN = /-search-preview\b/;

/**
 * Soft-degrade warning surfaced to the transport layer.  The payload
 * builder already omits the field that would be silently dropped by
 * the upstream; the warning lets the browser toast the user so they
 * know why the search intent didn't take effect.
 */
export interface LlmWarning {
  code: 'web_search.unsupported_sku';
  model: string;
  profile: ProviderProfile;
}

export interface ChatPayloadInput {
  profile: ProviderProfile;
  model: string;
  // Minimal message shape — each provider branch narrows further.
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature: number;
  stream: boolean;
  thinkingEnabled?: boolean;
  thinkingDepth?: ThinkingDepth;
  /**
   * Raw budget-token count for vendors that accept one
   * (Anthropic `thinking.budget_tokens`, DashScope `thinking_budget`).
   * When absent, a sensible default is derived from `thinkingDepth`.
   */
  thinkingBudget?: number;
  visionEnabled?: boolean;
  webSearchEnabled?: boolean;
  /**
   * OpenAI Anthropic uses `system` as a top-level string field, not a
   * message.  For the OpenAI family, `system` is forwarded as a
   * regular message.  This lets the caller separate the concern so
   * the same Input can feed either branch.
   */
  anthropicSystem?: string;
}

/**
 * Map a UI-level ThinkingDepth (off/minimal/low/medium/high/xhigh)
 * to an OpenAI `reasoning_effort` enum value.  OpenAI only defines
 * low/medium/high at the time of writing — we collapse the 6-way
 * knob onto that 3-way space to avoid sending values the API will
 * reject.  `off` is a no-op (the field is omitted entirely).
 */
export function mapDepthToReasoningEffort(
  depth: ThinkingDepth | undefined,
): 'low' | 'medium' | 'high' | undefined {
  switch (depth) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
      return 'high';
    case 'off':
    case undefined:
    default:
      return undefined;
  }
}

/**
 * Derive a sane Anthropic/DashScope budget_tokens default when the
 * caller did not pass an explicit `thinkingBudget`.  Values chosen
 * so medium ≈ 4k tokens of private reasoning, consistent with the
 * defaults the capability probe already uses.
 */
export function defaultBudgetForDepth(depth: ThinkingDepth | undefined): number {
  switch (depth) {
    case 'minimal':
      return 1024;
    case 'low':
      return 2048;
    case 'medium':
      return 4096;
    case 'high':
      return 8192;
    case 'xhigh':
      return 16384;
    case 'off':
    case undefined:
    default:
      // Anthropic requires >= 1024 when thinking is enabled at all,
      // so fall back to the minimum valid value rather than 0.
      return 1024;
  }
}

/**
 * Build the upstream request body for a real chat turn, given the
 * already-detected provider profile.  The route handler is responsible
 * for applying this to the transport (OpenAI POSTs to `/chat/completions`;
 * Anthropic POSTs to `/messages`).
 */
export function buildChatPayload(input: ChatPayloadInput): Record<string, unknown> {
  switch (input.profile) {
    case 'anthropic':
      return buildAnthropicBody(input);
    case 'dashscope':
      return buildDashScopeBody(input);
    case 'openai':
    case 'azure-openai':
      return buildOpenAiBody(input);
    default:
      return buildGenericBody(input);
  }
}

/**
 * Convenience: detect + build in one call for callers that only have
 * (baseUrl, apiType).  Kept separate from `buildChatPayload` so the
 * route handler can detect once and reuse the profile for URL/header
 * decisions too.
 */
export function buildChatPayloadFor(
  baseUrl: string,
  apiType: ApiType,
  input: Omit<ChatPayloadInput, 'profile'>,
): Record<string, unknown> {
  const profile = detectProviderProfile(baseUrl, apiType);
  return buildChatPayload({ ...input, profile });
}

// -- Anthropic ---------------------------------------------------------------
//
// Thinking:  `thinking: { type: 'enabled', budget_tokens }`
//            must bump `max_tokens` above budget_tokens.
// WebSearch: `tools: [{ type: 'web_search_20250305' }]`
// Vision:    driven by message content blocks — builder is pass-through.

function buildAnthropicBody(input: ChatPayloadInput): Record<string, unknown> {
  const chatMessages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: input.model,
    messages: chatMessages,
    max_tokens: 8192,
    temperature: input.temperature,
    stream: input.stream,
  };

  if (input.anthropicSystem) {
    body.system = input.anthropicSystem;
  }

  if (input.thinkingEnabled && input.thinkingDepth !== 'off') {
    const budget = Math.max(
      input.thinkingBudget ?? defaultBudgetForDepth(input.thinkingDepth),
      1024,
    );
    body.thinking = { type: 'enabled', budget_tokens: budget };
    // Anthropic requires max_tokens > budget_tokens.  Leave headroom.
    body.max_tokens = Math.max(budget + 1024, 8192);
  }

  if (input.webSearchEnabled) {
    body.tools = [{ ...WEB_SEARCH_TOOL_DEFINITION }];
  }

  return body;
}

// -- DashScope (Alibaba Cloud Model Studio) ----------------------------------
//
// Top-level switches — must NOT use OpenAI-style `reasoning_effort`
// or `web_search_options`, which DashScope silently ignores.

function buildDashScopeBody(input: ChatPayloadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    stream: input.stream,
  };

  if (input.thinkingEnabled && input.thinkingDepth !== 'off') {
    body.enable_thinking = true;
    const budget = input.thinkingBudget ?? defaultBudgetForDepth(input.thinkingDepth);
    if (budget > 0) {
      body.thinking_budget = budget;
    }
  }

  if (input.webSearchEnabled) {
    body.enable_search = true;
  }

  return body;
}

// -- OpenAI / Azure OpenAI ---------------------------------------------------
//
// Thinking:  `reasoning_effort: low|medium|high` (no budget_tokens).
// WebSearch: `web_search_options: { search_context_size }`.
// Vision:    driven by message content blocks.

function buildOpenAiBody(input: ChatPayloadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    stream: input.stream,
  };

  if (input.thinkingEnabled) {
    const effort = mapDepthToReasoningEffort(input.thinkingDepth);
    if (effort) {
      body.reasoning_effort = effort;
    }
  }

  // SU-ITER-096 · Bug B-3 — OpenAI upstream only honours
  // `web_search_options` on `*-search-preview` SKUs.  Sending the
  // field on gpt-4o / gpt-4o-mini / o1 etc. silently drops it, so
  // the user saw "search doesn't work".  We now soft-degrade:
  // omit the field and let `collectChatPayloadWarnings` surface
  // the mismatch so the UI can toast.
  if (input.webSearchEnabled && OPENAI_WEB_SEARCH_SKU_PATTERN.test(input.model)) {
    body.web_search_options = { search_context_size: 'medium' };
  }

  return body;
}

// -- Generic OpenAI-compatible (gateway-safe) --------------------------------
//
// This is the branch for Poe, OpenRouter, DeepSeek, Together, etc.
// The same gateway may proxy both OpenAI- and Anthropic-backed models.
// We therefore detect the upstream model family and emit the right
// fields:
//
//   - Claude via gateway → Anthropic-native `thinking` field.  Poe /
//     OpenRouter both accept this and route it correctly; sending
//     `reasoning_effort` to a Claude model has been observed to
//     translate into an invalid `thinking` budget on the gateway
//     side.
//   - Non-Claude via gateway → OpenAI-style `reasoning_effort`,
//     plus `enable_search` as a belt-and-suspenders hint for
//     Chinese gateways that use DashScope-style switches.

function buildGenericBody(input: ChatPayloadInput): Record<string, unknown> {
  const claude = isClaudeModel(input.model);
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    stream: input.stream,
  };

  if (input.thinkingEnabled && input.thinkingDepth !== 'off') {
    if (claude) {
      const budget = Math.max(
        input.thinkingBudget ?? defaultBudgetForDepth(input.thinkingDepth),
        1024,
      );
      body.thinking = { type: 'enabled', budget_tokens: budget };
      body.max_tokens = Math.max(budget + 1024, 8192);
    } else {
      const effort = mapDepthToReasoningEffort(input.thinkingDepth);
      if (effort) {
        body.reasoning_effort = effort;
      }
    }
  }

  if (input.webSearchEnabled) {
    if (claude) {
      // SU-ITER-096 · Bug B-1 — Claude routed through a generic
      // gateway (Poe / OpenRouter) needs the Anthropic-native
      // `tools: [{type: 'web_search_20250305'}]` marker.  Without
      // it the upstream never engages the web-search tool and
      // the user sees "llm-native 搜索无法使用".
      body.tools = [{ ...WEB_SEARCH_TOOL_DEFINITION }];
    } else if (OPENAI_WEB_SEARCH_SKU_PATTERN.test(input.model)) {
      // SU-ITER-096 · Bug B-3 (gateway mirror) — same SKU gate
      // as the native OpenAI branch.  Non search-preview SKUs
      // get soft-degraded and flagged via collectChatPayloadWarnings.
      body.web_search_options = { search_context_size: 'medium' };
    }
    // enable_search is a DashScope-style field — harmless on gateways
    // that ignore it, useful on domestic proxies that require it.
    body.enable_search = true;
  }

  return body;
}

// ----------------------------------------------------------------
// SU-ITER-096 · warnings collector
//
// Called by the route handler *after* `buildChatPayload`.  The
// builder itself stays body-only (preserving the existing
// signature and tests); the collector inspects the same input
// and returns any soft-degrade warnings that should be surfaced
// to the browser via response headers.
// ----------------------------------------------------------------
export function collectChatPayloadWarnings(input: ChatPayloadInput): LlmWarning[] {
  const warnings: LlmWarning[] = [];

  if (!input.webSearchEnabled) return warnings;

  // Tools-based paths are always supported — no warning needed.
  if (input.profile === 'anthropic') return warnings;
  if (input.profile === 'generic-openai-compatible' && isClaudeModel(input.model)) {
    return warnings;
  }

  // OpenAI + generic (non-Claude) both need a `*-search-preview` SKU
  // for `web_search_options` to take effect upstream.  Anything else
  // is a silent-drop on the vendor side → warn the user.
  if (input.profile === 'openai' || input.profile === 'generic-openai-compatible') {
    if (!OPENAI_WEB_SEARCH_SKU_PATTERN.test(input.model)) {
      warnings.push({
        code: 'web_search.unsupported_sku',
        model: input.model,
        profile: input.profile,
      });
    }
  }

  // DashScope honours `enable_search` directly → no warning.
  return warnings;
}
