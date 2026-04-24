// SU-ITER-090a · P2-05 — Zod schema guards for the LLM chat proxy.
//
// Scope: verify the request-envelope validation rules (not the upstream
// fan-out). Full handler tests are out of scope for SU-090a; see SU-092
// for the end-to-end RTL/route layer.

import { describe, it, expect } from 'vitest';
import {
  ChatRequestSchema,
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
} from './route';

function validBody() {
  return {
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-abc',
    apiType: 'openai' as const,
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
  };
}

describe('ChatRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const r = ChatRequestSchema.safeParse(validBody());
    expect(r.success).toBe(true);
  });

  it('accepts optional temperature + stream', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      temperature: 0.2,
      stream: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const r = ChatRequestSchema.safeParse({ ...validBody(), baseUrl: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes('baseUrl'))).toBe(true);
    }
  });

  it('rejects unknown apiType enum value', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      apiType: 'bedrock',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty messages array', () => {
    const r = ChatRequestSchema.safeParse({ ...validBody(), messages: [] });
    expect(r.success).toBe(false);
  });

  it('rejects message arrays over MAX_MESSAGES with a too_big issue (413-eligible)', () => {
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => ({
      role: 'user',
      content: 'x',
    }));
    const r = ChatRequestSchema.safeParse({ ...validBody(), messages: many });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.code === 'too_big')).toBe(true);
    }
  });

  it('rejects a single message over MAX_MESSAGE_LENGTH with too_big', () => {
    const big = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      messages: [{ role: 'user', content: big }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.code === 'too_big')).toBe(true);
    }
  });

  it('accepts exactly MAX_MESSAGES messages at the cap', () => {
    const atCap = Array.from({ length: MAX_MESSAGES }, () => ({
      role: 'user',
      content: 'hi',
    }));
    const r = ChatRequestSchema.safeParse({ ...validBody(), messages: atCap });
    expect(r.success).toBe(true);
  });

  it('accepts content of exactly MAX_MESSAGE_LENGTH chars', () => {
    const atCap = 'x'.repeat(MAX_MESSAGE_LENGTH);
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      messages: [{ role: 'user', content: atCap }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects temperature out of range', () => {
    const r1 = ChatRequestSchema.safeParse({ ...validBody(), temperature: -0.1 });
    expect(r1.success).toBe(false);
    const r2 = ChatRequestSchema.safeParse({ ...validBody(), temperature: 2.1 });
    expect(r2.success).toBe(false);
  });

  it('rejects unknown top-level keys (.strict())', () => {
    const r = ChatRequestSchema.safeParse({ ...validBody(), hacky: true });
    expect(r.success).toBe(false);
  });

  it('rejects unknown keys inside a message (.strict())', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      messages: [{ role: 'user', content: 'x', extra: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

// SU-ITER-093 — capability-flag envelope.  The proxy must accept the
// new optional fields so the client can thread the user's thinking /
// vision / web-search toggles through to the provider-aware payload
// builder.  Fields must remain OPTIONAL to keep backward compatibility
// with older clients that still post the minimal envelope.
describe('ChatRequestSchema — capability flags (SU-ITER-093)', () => {
  it('accepts the full capability envelope', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      thinkingEnabled: true,
      thinkingDepth: 'medium',
      thinkingBudget: 4096,
      visionEnabled: true,
      webSearchEnabled: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts envelope without any capability flags (backward compat)', () => {
    const r = ChatRequestSchema.safeParse(validBody());
    expect(r.success).toBe(true);
  });

  it('rejects unknown thinkingDepth enum values', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      thinkingDepth: 'ultra',
    });
    expect(r.success).toBe(false);
  });

  it('accepts all six valid thinkingDepth levels', () => {
    const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    for (const depth of levels) {
      const r = ChatRequestSchema.safeParse({ ...validBody(), thinkingDepth: depth });
      expect(r.success).toBe(true);
    }
  });

  it('rejects negative thinkingBudget', () => {
    const r = ChatRequestSchema.safeParse({ ...validBody(), thinkingBudget: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects thinkingBudget above the upper bound', () => {
    const r = ChatRequestSchema.safeParse({ ...validBody(), thinkingBudget: 70000 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer thinkingBudget', () => {
    const r = ChatRequestSchema.safeParse({ ...validBody(), thinkingBudget: 1024.5 });
    expect(r.success).toBe(false);
  });
});

// SU-ITER-094 · Phase-C — search-context envelope.  When the user
// picks a concrete search backend (Brave / Firecrawl) the browser
// threads the tool choice, its API key, an optional whitelist, and
// the max tool-iteration count through the proxy so the tool-loop
// handler can fan out to the correct backend.  All five fields are
// optional to preserve backward compatibility with clients that
// haven't adopted the new search UI yet.
describe('ChatRequestSchema — search context (SU-ITER-094)', () => {
  it('accepts the full search envelope', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      webSearchEnabled: true,
      searchTool: 'brave',
      searchToolApiKey: 'brave-key',
      searchToolBaseUrl: 'https://api.search.brave.com',
      searchWhitelist: ['example.com', '*.news.com'],
      maxToolIterations: 5,
    });
    expect(r.success).toBe(true);
  });

  it('accepts llm-native search tool', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      searchTool: 'llm-native',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown searchTool values', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      searchTool: 'google',
    });
    expect(r.success).toBe(false);
  });

  it('rejects maxToolIterations below 1', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      maxToolIterations: 0,
    });
    expect(r.success).toBe(false);
  });

  it('rejects maxToolIterations above 10', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      maxToolIterations: 11,
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer maxToolIterations', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      maxToolIterations: 3.5,
    });
    expect(r.success).toBe(false);
  });

  it('rejects an over-sized whitelist array', () => {
    const oversized = Array.from({ length: 1025 }, (_, i) => `s${i}.com`);
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      searchWhitelist: oversized,
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty strings inside the whitelist', () => {
    const r = ChatRequestSchema.safeParse({
      ...validBody(),
      searchWhitelist: ['valid.com', ''],
    });
    expect(r.success).toBe(false);
  });
});
