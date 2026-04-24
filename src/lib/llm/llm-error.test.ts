import { describe, it, expect, vi } from 'vitest';
import { classifyLlmError, retryOnce } from './llm-error';

describe('classifyLlmError', () => {
  it('classifies 401/403 as auth and non-retryable', () => {
    const a = classifyLlmError(new Error('LLM 调用失败 (401): unauthorized'));
    const b = classifyLlmError({ status: 403 });
    expect(a.category).toBe('auth');
    expect(a.retryable).toBe(false);
    expect(b.category).toBe('auth');
  });

  it('classifies 429 as rate_limit and retryable', () => {
    const info = classifyLlmError(new Error('HTTP 429: too many requests'));
    expect(info.category).toBe('rate_limit');
    expect(info.retryable).toBe(true);
  });

  it('classifies 400/404 as model_unavailable and non-retryable', () => {
    expect(classifyLlmError({ status: 404 }).category).toBe('model_unavailable');
    expect(classifyLlmError(new Error('HTTP 400: unknown model')).category).toBe('model_unavailable');
    expect(classifyLlmError({ status: 400 }).retryable).toBe(false);
  });

  it('classifies 5xx as upstream and retryable', () => {
    const info = classifyLlmError(new Error('HTTP 502: bad gateway'));
    expect(info.category).toBe('upstream');
    expect(info.retryable).toBe(true);
  });

  it('classifies TypeError / fetch failures as network', () => {
    const info = classifyLlmError(new TypeError('Failed to fetch'));
    expect(info.category).toBe('network');
    expect(info.retryable).toBe(true);
  });

  it('classifies unknown errors as upstream with detail preserved', () => {
    const info = classifyLlmError(new Error('something weird happened'));
    expect(info.category).toBe('upstream');
    expect(info.detail).toContain('something weird happened');
  });

  it('passes through already-classified LlmErrorInfo unchanged', () => {
    const pre = { category: 'rate_limit' as const, messageKey: 'llm.error.rateLimit', retryable: true };
    expect(classifyLlmError(pre)).toBe(pre);
  });
});

describe('retryOnce', () => {
  it('returns the first attempt if it succeeds', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await retryOnce(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries once on a retryable error and returns the second result', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('HTTP 502: bad gateway');
      return 'ok-after-retry';
    });
    const result = await retryOnce(fn, { backoffMs: 1 });
    expect(result).toBe('ok-after-retry');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable error (e.g. auth)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('HTTP 401: unauthorized');
    });
    await expect(retryOnce(fn, { backoffMs: 1 })).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledOnce();
  });
});
