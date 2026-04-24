// SU-ITER-090a · R10 — tests for the sliding-window in-process limiter.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter · sliding window', () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_700_000_000_000;
  });

  it('allows up to `max` hits inside the window', () => {
    const rl = createRateLimiter({ max: 3, windowMs: 60_000, now });
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(true);
    const fourth = rl.check('k');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.resetMs).toBeGreaterThan(0);
  });

  it('lets requests through again after the window rolls', () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1_000, now });
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(false);
    clock += 1_001;
    expect(rl.check('k').allowed).toBe(true);
  });

  it('reports decreasing `resetMs` as time advances', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 10_000, now });
    rl.check('k');
    clock += 2_000;
    const res = rl.check('k');
    expect(res.allowed).toBe(false);
    expect(res.resetMs).toBeLessThanOrEqual(8_000);
    expect(res.resetMs).toBeGreaterThan(7_900);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('b').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(false);
  });

  it('evicts LRU keys when capacity is exceeded', () => {
    const rl = createRateLimiter({ max: 10, windowMs: 60_000, now, maxKeys: 3 });
    rl.check('a'); rl.check('b'); rl.check('c');
    expect(rl.size()).toBe(3);
    rl.check('d'); // evicts 'a'
    expect(rl.size()).toBe(3);
    // 'a' is back to a fresh window
    const aAgain = rl.check('a');
    expect(aAgain.allowed).toBe(true);
    expect(aAgain.remaining).toBe(9);
  });

  it('reset() clears all state', () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now });
    rl.check('k');
    expect(rl.check('k').allowed).toBe(false);
    rl.reset();
    expect(rl.size()).toBe(0);
    expect(rl.check('k').allowed).toBe(true);
  });
});
