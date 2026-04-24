import { AUTH_CONSTANTS } from '@/types';

// ============================================================
// SU-088 · P0-B: pure helpers for the server-side lockout ladder.
// The HTTP route handler keeps orchestration (IO / Argon2id verify),
// while these helpers encode the state-machine that decides whether
// a given account is currently locked, how many attempts remain after
// a failure, and when the lock window should be cleared.  Kept pure
// so they can be unit-tested without spinning up Next.js.
// ============================================================

export interface LockoutAccountView {
  failedAttempts: number;
  lockUntil: string | null;
}

export interface LockoutDecision {
  locked: boolean;
  /** Milliseconds until the lock expires, 0 when not locked. */
  remainingMs: number;
  /** Integer minutes (ceil) shown in UI. */
  remainingMinutes: number;
}

/** Inspect an account and decide whether it is currently locked. */
export function evaluateLockout(
  account: Pick<LockoutAccountView, 'lockUntil'>,
  now: number = Date.now(),
): LockoutDecision {
  if (!account.lockUntil) return { locked: false, remainingMs: 0, remainingMinutes: 0 };
  const until = Date.parse(account.lockUntil);
  if (!Number.isFinite(until)) return { locked: false, remainingMs: 0, remainingMinutes: 0 };
  const remainingMs = until - now;
  if (remainingMs <= 0) return { locked: false, remainingMs: 0, remainingMinutes: 0 };
  return {
    locked: true,
    remainingMs,
    remainingMinutes: Math.ceil(remainingMs / 60000),
  };
}

export interface FailureProgression {
  failedAttempts: number;
  lockUntil: string | null;
  /** Remaining attempts before a new lock kicks in (0 once locked). */
  remaining: number;
  locked: boolean;
}

/**
 * Produce the next state after a failed password verification.  Returns
 * a new object so callers can persist it deterministically.
 */
export function registerFailure(
  account: LockoutAccountView,
  now: number = Date.now(),
): FailureProgression {
  const next = (account.failedAttempts ?? 0) + 1;
  const locked = next >= AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS;
  return {
    failedAttempts: next,
    lockUntil: locked
      ? new Date(now + AUTH_CONSTANTS.LOCKOUT_DURATION_MS).toISOString()
      : null,
    remaining: Math.max(0, AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS - next),
    locked,
  };
}

/** Produce the reset state after a successful password verification. */
export function resetLockout(): LockoutAccountView {
  return { failedAttempts: 0, lockUntil: null };
}
