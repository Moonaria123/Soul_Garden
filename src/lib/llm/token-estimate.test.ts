// SU-ITER-094 · Phase D — token-estimate unit tests.

import { describe, expect, it } from 'vitest';
import {
  INPUT_TOKEN_BUDGET_RATIO,
  computeInputTokenBudget,
  estimateMessagesTokens,
  estimateTokens,
  truncateMessagesToBudget,
} from './token-estimate';

describe('estimateTokens', () => {
  it('returns 0 for empty / null / undefined', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('applies the 0.45 char coefficient with ceil rounding', () => {
    // "hello world" → 11 chars * 0.45 = 4.95 → 5
    expect(estimateTokens('hello world')).toBe(5);
    // 100 chars → 45
    expect(estimateTokens('x'.repeat(100))).toBe(45);
  });

  it('is monotonic in content length', () => {
    expect(estimateTokens('a')).toBeLessThanOrEqual(estimateTokens('aa'));
    expect(estimateTokens('aa')).toBeLessThanOrEqual(estimateTokens('aaa'));
  });
});

describe('estimateMessagesTokens', () => {
  it('returns 2 (priming) for an empty array', () => {
    expect(estimateMessagesTokens([])).toBe(2);
  });

  it('adds 4-token envelope per message', () => {
    const msgs = [
      { role: 'system', content: 'a'.repeat(100) }, // 45 content
      { role: 'user', content: 'a'.repeat(100) }, // 45 content
    ];
    // 2 priming + (4 + 45) + (4 + 45) = 100
    expect(estimateMessagesTokens(msgs)).toBe(100);
  });
});

describe('computeInputTokenBudget', () => {
  it('returns null for missing / invalid window sizes', () => {
    expect(computeInputTokenBudget(null)).toBeNull();
    expect(computeInputTokenBudget(undefined)).toBeNull();
    expect(computeInputTokenBudget(0)).toBeNull();
    expect(computeInputTokenBudget(-100)).toBeNull();
    expect(computeInputTokenBudget(Number.NaN)).toBeNull();
    expect(computeInputTokenBudget(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('applies the 0.7 ratio with floor rounding', () => {
    expect(computeInputTokenBudget(10_000)).toBe(7_000);
    expect(computeInputTokenBudget(8_192)).toBe(Math.floor(8_192 * INPUT_TOKEN_BUDGET_RATIO));
  });
});

describe('truncateMessagesToBudget', () => {
  const mk = (role: 'system' | 'user' | 'assistant', content: string) => ({ role, content });

  it('short-circuits when budget is null', () => {
    const msgs = [
      mk('system', 'sys'),
      mk('user', 'hi'),
      mk('assistant', 'hello'),
      mk('user', 'again'),
    ];
    const r = truncateMessagesToBudget(msgs, null);
    expect(r.kept).toEqual(msgs);
    expect(r.droppedCount).toBe(0);
  });

  it('returns pass-through when already under budget', () => {
    const msgs = [mk('system', 'sys'), mk('user', 'hi'), mk('user', 'again')];
    const r = truncateMessagesToBudget(msgs, 10_000);
    expect(r.droppedCount).toBe(0);
    expect(r.kept).toHaveLength(3);
  });

  it('keeps system + last user even when only 2 messages', () => {
    const msgs = [mk('system', 'sys'), mk('user', 'hi')];
    const r = truncateMessagesToBudget(msgs, 5);
    expect(r.kept).toHaveLength(2);
    expect(r.droppedCount).toBe(0);
  });

  it('drops oldest middle messages first until the budget fits', () => {
    const msgs = [
      mk('system', 'sys'), // envelope+content ~= 4 + 2 = 6
      mk('user', 'a'.repeat(100)), // 4 + 45 = 49
      mk('assistant', 'b'.repeat(100)), // 49
      mk('user', 'c'.repeat(100)), // 49
      mk('assistant', 'd'.repeat(100)), // 49
      mk('user', 'last'), // 4 + 2 = 6
    ];
    // Full: 2 + 6 + 49*4 + 6 = 210.  Budget 120 → must drop oldest
    // middle until total <= 120.  Fixed pair = 2 + 6 + 6 = 14.
    // Available for middle = 106 → fits 2 middle messages (49*2=98).
    const r = truncateMessagesToBudget(msgs, 120);
    expect(r.kept[0].content).toBe('sys');
    expect(r.kept[r.kept.length - 1].content).toBe('last');
    expect(r.droppedCount).toBeGreaterThan(0);
    // The *last* middle messages (closest to the current turn) are the
    // ones retained.
    expect(r.kept.some((m) => m.content === 'd'.repeat(100))).toBe(true);
    // The first middle message is the first to be dropped.
    expect(r.kept.some((m) => m.content === 'a'.repeat(100))).toBe(false);
  });

  it('returns only system + last user when budget is too small for either', () => {
    const msgs = [
      mk('system', 'x'.repeat(1000)),
      mk('user', 'middle'),
      mk('assistant', 'reply'),
      mk('user', 'x'.repeat(1000)),
    ];
    // Fixed cost is already > budget 10 → return the required pair,
    // drop middle.
    const r = truncateMessagesToBudget(msgs, 10);
    expect(r.kept).toHaveLength(2);
    expect(r.droppedCount).toBe(2);
  });

  it('never drops the system message', () => {
    const msgs = [
      mk('system', 'SYS-MARKER'),
      ...Array.from({ length: 50 }, (_, i) => mk('assistant', `m${i}`.repeat(100))),
      mk('user', 'now'),
    ];
    const r = truncateMessagesToBudget(msgs, 200);
    expect(r.kept[0].content).toBe('SYS-MARKER');
    expect(r.kept[r.kept.length - 1].content).toBe('now');
  });

  it('reports estimatedTokens of the kept slice', () => {
    const msgs = [mk('system', 'a'.repeat(100)), mk('user', 'b'.repeat(100))];
    const r = truncateMessagesToBudget(msgs, 10_000);
    expect(r.estimatedTokens).toBe(estimateMessagesTokens(r.kept));
  });
});
