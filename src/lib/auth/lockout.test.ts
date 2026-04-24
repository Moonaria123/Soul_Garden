import { describe, it, expect } from 'vitest';
import { AUTH_CONSTANTS } from '@/types';
import { evaluateLockout, registerFailure, resetLockout } from './lockout';

// SU-088 · P0-B — lockout state-machine tests.

describe('evaluateLockout', () => {
  it('treats null lockUntil as unlocked', () => {
    const d = evaluateLockout({ lockUntil: null });
    expect(d.locked).toBe(false);
    expect(d.remainingMs).toBe(0);
  });

  it('ignores invalid timestamps', () => {
    const d = evaluateLockout({ lockUntil: 'not-a-date' });
    expect(d.locked).toBe(false);
  });

  it('reports locked while the window is active', () => {
    const now = 1_000_000;
    const until = new Date(now + 60_000).toISOString();
    const d = evaluateLockout({ lockUntil: until }, now);
    expect(d.locked).toBe(true);
    expect(d.remainingMs).toBe(60_000);
    expect(d.remainingMinutes).toBe(1);
  });

  it('reports unlocked once the window has elapsed', () => {
    const now = 2_000_000;
    const until = new Date(now - 1).toISOString();
    const d = evaluateLockout({ lockUntil: until }, now);
    expect(d.locked).toBe(false);
  });
});

describe('registerFailure', () => {
  const base = { failedAttempts: 0, lockUntil: null } as const;

  it('increments attempts without locking until the threshold', () => {
    const p = registerFailure(base);
    expect(p.failedAttempts).toBe(1);
    expect(p.locked).toBe(false);
    expect(p.lockUntil).toBeNull();
    expect(p.remaining).toBe(AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS - 1);
  });

  it('locks exactly at the configured threshold', () => {
    const now = 5_000_000;
    const prior = { failedAttempts: AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS - 1, lockUntil: null };
    const p = registerFailure(prior, now);
    expect(p.failedAttempts).toBe(AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS);
    expect(p.locked).toBe(true);
    expect(p.remaining).toBe(0);
    expect(p.lockUntil).toBe(
      new Date(now + AUTH_CONSTANTS.LOCKOUT_DURATION_MS).toISOString(),
    );
  });

  it('keeps locking on repeat failures past the threshold', () => {
    const now = 10_000_000;
    const prior = { failedAttempts: AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS + 3, lockUntil: null };
    const p = registerFailure(prior, now);
    expect(p.locked).toBe(true);
    expect(p.lockUntil).not.toBeNull();
    expect(p.remaining).toBe(0);
  });
});

describe('resetLockout', () => {
  it('returns a zeroed state', () => {
    expect(resetLockout()).toEqual({ failedAttempts: 0, lockUntil: null });
  });
});
