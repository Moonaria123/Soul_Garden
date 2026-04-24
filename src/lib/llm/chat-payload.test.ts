// SU-ITER-093 — provider-aware chat payload builder.  These tests pin
// down the vendor field-name translation table: each profile must emit
// the correct combination of (thinking, webSearch) fields for the
// flags we pass in.  The probe layer already has its own translation
// table; this file guards the RUNTIME chat translation so the two
// never drift.

import { describe, it, expect } from 'vitest';
import {
  buildChatPayload,
  mapDepthToReasoningEffort,
  defaultBudgetForDepth,
  collectChatPayloadWarnings,
  OPENAI_WEB_SEARCH_SKU_PATTERN,
  WEB_SEARCH_TOOL_DEFINITION,
} from './chat-payload';

const baseInput = {
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.7,
  stream: true,
};

describe('mapDepthToReasoningEffort', () => {
  it('collapses the 6-level depth onto OpenAI low/medium/high', () => {
    expect(mapDepthToReasoningEffort('minimal')).toBe('low');
    expect(mapDepthToReasoningEffort('low')).toBe('low');
    expect(mapDepthToReasoningEffort('medium')).toBe('medium');
    expect(mapDepthToReasoningEffort('high')).toBe('high');
    expect(mapDepthToReasoningEffort('xhigh')).toBe('high');
  });

  it('returns undefined for off / undefined so the field is omitted', () => {
    expect(mapDepthToReasoningEffort('off')).toBeUndefined();
    expect(mapDepthToReasoningEffort(undefined)).toBeUndefined();
  });
});

describe('defaultBudgetForDepth', () => {
  it('produces monotonically non-decreasing budgets', () => {
    const budgets = (['minimal', 'low', 'medium', 'high', 'xhigh'] as const).map(
      defaultBudgetForDepth,
    );
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1]);
    }
  });

  it('never goes below the Anthropic minimum of 1024', () => {
    expect(defaultBudgetForDepth(undefined)).toBeGreaterThanOrEqual(1024);
    expect(defaultBudgetForDepth('off')).toBeGreaterThanOrEqual(1024);
  });
});

describe('buildChatPayload — openai profile', () => {
  it('emits reasoning_effort when thinking is enabled', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'openai',
      thinkingEnabled: true,
      thinkingDepth: 'high',
    });
    expect(body.reasoning_effort).toBe('high');
    expect(body.thinking).toBeUndefined();
  });

  it('emits web_search_options when web search is enabled on a -search-preview SKU', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'openai',
      model: 'gpt-4o-search-preview',
      webSearchEnabled: true,
    });
    expect(body.web_search_options).toEqual({ search_context_size: 'medium' });
  });

  // SU-ITER-096 · Bug B-3 — OpenAI silently ignores `web_search_options`
  // on any model that is not a `*-search-preview` SKU.  Instead of
  // forwarding a field the upstream will drop, soft-degrade: omit the
  // field and let the warning collector flag it for the UI toast.
  it('omits web_search_options for non -search-preview OpenAI SKUs (SU-096 B-3)', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'openai',
      model: 'gpt-4o',
      webSearchEnabled: true,
    });
    expect(body.web_search_options).toBeUndefined();
  });

  it('omits capability fields when flags are false', () => {
    const body = buildChatPayload({ ...baseInput, profile: 'openai' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.web_search_options).toBeUndefined();
  });
});

describe('buildChatPayload — anthropic profile', () => {
  it('emits thinking block with budget_tokens and bumps max_tokens', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'anthropic',
      model: 'claude-sonnet-4-6',
      thinkingEnabled: true,
      thinkingDepth: 'medium',
      thinkingBudget: 4096,
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    // Anthropic requires max_tokens > budget_tokens.
    expect(Number(body.max_tokens)).toBeGreaterThan(4096);
  });

  it('lifts the system message into a top-level system field', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'anthropic',
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hi' },
      ],
      anthropicSystem: 'you are helpful',
    });
    expect(body.system).toBe('you are helpful');
    expect(Array.isArray(body.messages)).toBe(true);
    const msgs = body.messages as { role: string }[];
    expect(msgs.every((m) => m.role !== 'system')).toBe(true);
  });

  it('emits web_search_20250305 tool when web search is enabled', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'anthropic',
      webSearchEnabled: true,
    });
    expect(body.tools).toEqual([{ type: 'web_search_20250305' }]);
  });

  it('does NOT emit OpenAI-style fields on anthropic', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'anthropic',
      thinkingEnabled: true,
      thinkingDepth: 'high',
      webSearchEnabled: true,
    });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.web_search_options).toBeUndefined();
  });
});

describe('buildChatPayload — dashscope profile', () => {
  it('emits top-level enable_thinking + thinking_budget', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'dashscope',
      thinkingEnabled: true,
      thinkingDepth: 'medium',
    });
    expect(body.enable_thinking).toBe(true);
    expect(Number(body.thinking_budget)).toBeGreaterThan(0);
  });

  it('emits enable_search for web search', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'dashscope',
      webSearchEnabled: true,
    });
    expect(body.enable_search).toBe(true);
  });

  it('does NOT emit OpenAI- or Anthropic-style fields', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'dashscope',
      thinkingEnabled: true,
      thinkingDepth: 'high',
      webSearchEnabled: true,
    });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.web_search_options).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });
});

describe('buildChatPayload — generic-openai-compatible profile', () => {
  it('emits Anthropic-native thinking for Claude models behind a gateway', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'claude-3-5-sonnet',
      thinkingEnabled: true,
      thinkingDepth: 'medium',
    });
    expect(body.thinking).toMatchObject({ type: 'enabled' });
    // Claude via gateway must NOT receive OpenAI-style reasoning_effort.
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('emits OpenAI-style reasoning_effort for non-Claude models behind a gateway', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'gpt-4o-mini',
      thinkingEnabled: true,
      thinkingDepth: 'low',
    });
    expect(body.reasoning_effort).toBe('low');
    expect(body.thinking).toBeUndefined();
  });

  it('emits enable_search alongside web_search_options for non-Claude gateway on a search-preview SKU', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'gpt-4o-search-preview',
      webSearchEnabled: true,
    });
    expect(body.enable_search).toBe(true);
    expect(body.web_search_options).toEqual({ search_context_size: 'medium' });
  });

  // SU-ITER-096 · Bug B-3 (gateway mirror) — qwen/generic non-Claude
  // gateways do not honour `web_search_options` on non search-preview
  // SKUs either.  Keep `enable_search` (DashScope-style harmless hint)
  // but drop the OpenAI-only field.
  it('omits web_search_options for non-Claude non search-preview gateway SKUs (SU-096 B-3)', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'qwen-max',
      webSearchEnabled: true,
    });
    expect(body.web_search_options).toBeUndefined();
    expect(body.enable_search).toBe(true);
  });

  it('does NOT emit OpenAI-style web_search_options on Claude gateways', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'claude-3-5-sonnet',
      webSearchEnabled: true,
    });
    expect(body.web_search_options).toBeUndefined();
  });

  // SU-ITER-096 · Bug B-1 — Anthropic Claude routed through a generic
  // OpenAI-compatible gateway (Poe / OpenRouter) needs the Anthropic
  // `tools: [{type:'web_search_20250305'}]` marker to actually trigger
  // the upstream web-search tool.  Previously we only set the DashScope
  // `enable_search` hint, which Claude ignores — so the end user saw
  // "llm-native 搜索无法使用".
  it('emits Anthropic web_search tool on Claude gateways (SU-096 B-1)', () => {
    const body = buildChatPayload({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'claude-3-5-sonnet',
      webSearchEnabled: true,
    });
    expect(body.tools).toEqual([{ type: 'web_search_20250305' }]);
    // Defence-in-depth: keep enable_search as a harmless hint for
    // domestic gateways that also relay Claude traffic.
    expect(body.enable_search).toBe(true);
  });
});

// SU-ITER-096 · Bug B-3 — warnings collector surfaces the soft-degrade
// decisions to the transport layer so the browser can toast the user
// instead of silently dropping capabilities.
describe('collectChatPayloadWarnings — web search SKU soft-degrade (SU-096)', () => {
  it('flags non search-preview OpenAI SKU as unsupported', () => {
    const warnings = collectChatPayloadWarnings({
      ...baseInput,
      profile: 'openai',
      model: 'gpt-4o',
      webSearchEnabled: true,
    });
    expect(warnings).toEqual([
      { code: 'web_search.unsupported_sku', model: 'gpt-4o', profile: 'openai' },
    ]);
  });

  it('does NOT flag a -search-preview SKU', () => {
    const warnings = collectChatPayloadWarnings({
      ...baseInput,
      profile: 'openai',
      model: 'gpt-4o-search-preview',
      webSearchEnabled: true,
    });
    expect(warnings).toEqual([]);
  });

  it('flags non-Claude non search-preview gateway SKU as unsupported', () => {
    const warnings = collectChatPayloadWarnings({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'qwen-max',
      webSearchEnabled: true,
    });
    expect(warnings.some((w) => w.code === 'web_search.unsupported_sku')).toBe(true);
  });

  it('does NOT flag Claude gateway (tools-based path is supported)', () => {
    const warnings = collectChatPayloadWarnings({
      ...baseInput,
      profile: 'generic-openai-compatible',
      model: 'claude-3-5-sonnet',
      webSearchEnabled: true,
    });
    expect(warnings).toEqual([]);
  });

  it('does NOT flag Anthropic profile (tools-based path is supported)', () => {
    const warnings = collectChatPayloadWarnings({
      ...baseInput,
      profile: 'anthropic',
      webSearchEnabled: true,
    });
    expect(warnings).toEqual([]);
  });

  it('returns empty when webSearchEnabled is false', () => {
    const warnings = collectChatPayloadWarnings({
      ...baseInput,
      profile: 'openai',
      model: 'gpt-4o',
    });
    expect(warnings).toEqual([]);
  });
});

describe('SU-ITER-096 exported constants', () => {
  it('OPENAI_WEB_SEARCH_SKU_PATTERN matches -search-preview SKUs', () => {
    expect(OPENAI_WEB_SEARCH_SKU_PATTERN.test('gpt-4o-search-preview')).toBe(true);
    expect(OPENAI_WEB_SEARCH_SKU_PATTERN.test('gpt-4o-search-preview-2025-03-11')).toBe(true);
    expect(OPENAI_WEB_SEARCH_SKU_PATTERN.test('gpt-4o')).toBe(false);
    expect(OPENAI_WEB_SEARCH_SKU_PATTERN.test('gpt-4o-mini')).toBe(false);
  });

  it('WEB_SEARCH_TOOL_DEFINITION carries the Anthropic tool marker', () => {
    expect(WEB_SEARCH_TOOL_DEFINITION).toEqual({ type: 'web_search_20250305' });
  });
});
