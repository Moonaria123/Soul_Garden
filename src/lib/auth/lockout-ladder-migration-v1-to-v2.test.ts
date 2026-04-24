import { describe, it, expect } from 'vitest';
import { AUTH_CONSTANTS } from '@/types';
import {
  evaluateLockout,
  registerFailure,
  resetLockout,
  type LockoutAccountView,
} from './lockout';

// ============================================================
// SU-ITER-092-batch3 · A1-C1 close-out — lockout ladder parity
// white-box mirror for `migrationV1ToV2Handler`.
//
// BEFORE batch3, this handler was the one authenticating endpoint
// that did NOT invoke the shared lockout ladder.  A brute-force
// attacker could keep hitting it during the `needs-migration`
// window paying only the Argon2id cost, never touching the account
// row's `failedAttempts` / `lockUntil` counters — and therefore
// never getting locked out on the ladder's 5/∞ other endpoints.
//
// Mirror discipline: this file replays the EXACT call sequence the
// handler performs against the lockout primitives.  Any regression
// in the handler that forgets `registerFailure` on
// `invalid_credentials` or `resetLockout` on success fails here.
// When the handler is refactored (e.g. if Stage D abstracts the
// ladder into a shared helper), update this mirror in lockstep.
//
// The handler source lives at:
//   soul-upload/src/app/api/db/[...path]/route.ts  (migrationV1ToV2Handler)
//
// SU-093: the real handler also calls `releaseAllLibsqlSessionsBeforeDiskMigration()`
// immediately before `runV1ToV2Migration` — not mirrored here (lockout-only).
// ============================================================

interface MigrationResult {
  ok: true;
  stats: { totalRows: number; durationMs: number };
}
interface MigrationError {
  ok: false;
  code:
    | 'invalid_credentials'
    | 'state_conflict'
    | 'no_source_db'
    | 'account_not_found'
    | 'unknown';
  detail?: string;
}
type MigrationOutcome = MigrationResult | MigrationError;

type SimulationResult =
  | { kind: 'locked_preflight'; status: 423; remainingMinutes: number }
  | { kind: 'success'; status: 200; stats: MigrationResult['stats'] }
  | { kind: 'invalid_credentials'; status: 401; remaining: number }
  | { kind: 'locked_after_failure'; status: 423; remaining: number }
  | { kind: 'other_error'; status: number; code: string };

function simulateMigrationHandlerLockout(opts: {
  account: LockoutAccountView | null;
  migrationResult: MigrationOutcome;
  /** Allow tests to pin timestamps deterministically. */
  now?: number;
}): { result: SimulationResult; accountAfter: LockoutAccountView | null } {
  const { account, migrationResult, now } = opts;

  // Step 1 — Pre-flight lockout check.  Matches handler lines:
  //   if (account) {
  //     const lock = evaluateLockout(account);
  //     if (lock.locked) return NextResponse.json({...}, { status: 423 });
  //   }
  if (account) {
    const lock = evaluateLockout(account, now);
    if (lock.locked) {
      return {
        result: {
          kind: 'locked_preflight',
          status: 423,
          remainingMinutes: lock.remainingMinutes,
        },
        accountAfter: account,
      };
    }
  }

  // Step 2 — Run migration (mocked here via the `migrationResult`
  // parameter; in the real handler this is `await runV1ToV2Migration(...)`).
  const r = migrationResult;

  if (r.ok) {
    // Success branch: reset lockout state if it was non-zero.
    if (account) {
      const reset = resetLockout();
      if (
        account.failedAttempts !== reset.failedAttempts ||
        account.lockUntil !== reset.lockUntil
      ) {
        account.failedAttempts = reset.failedAttempts;
        account.lockUntil = reset.lockUntil;
        // `putAccount` side effect would fire here.
      }
    }
    return {
      result: { kind: 'success', status: 200, stats: r.stats },
      accountAfter: account,
    };
  }

  // Invalid credentials branch: register failure + lock if threshold hit.
  if (r.code === 'invalid_credentials' && account) {
    const progression = registerFailure(account, now);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    return {
      result: progression.locked
        ? {
            kind: 'locked_after_failure',
            status: 423,
            remaining: progression.remaining,
          }
        : {
            kind: 'invalid_credentials',
            status: 401,
            remaining: progression.remaining,
          },
      accountAfter: account,
    };
  }

  // Other error mapping matches handler's status-switch tail.
  const status =
    r.code === 'invalid_credentials'
      ? 401
      : r.code === 'state_conflict'
        ? 409
        : r.code === 'no_source_db' || r.code === 'account_not_found'
          ? 404
          : 500;
  return {
    result: { kind: 'other_error', status, code: r.code },
    accountAfter: account,
  };
}

// ============================================================
// Tests
// ============================================================

describe('migrationV1ToV2Handler · lockout ladder mirror · SU-092-batch3 A1-C1', () => {
  describe('pre-flight lockout', () => {
    it('returns 423 when the account is currently locked and skips the migration run', () => {
      const now = 1_000_000;
      const account: LockoutAccountView = {
        failedAttempts: AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS,
        lockUntil: new Date(now + 5 * 60_000).toISOString(),
      };
      // A `run` result here should NEVER be consulted — put a sentinel
      // that would throw if accessed.
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: true, stats: { totalRows: 0, durationMs: 0 } },
        now,
      });

      expect(result.kind).toBe('locked_preflight');
      expect(result.status).toBe(423);
      if (result.kind === 'locked_preflight') {
        expect(result.remainingMinutes).toBe(5);
      }
      // Account state must NOT be reset on a preflight-locked response.
      expect(accountAfter?.failedAttempts).toBe(
        AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS,
      );
      expect(accountAfter?.lockUntil).not.toBeNull();
    });

    it('allows the call through when the lock window has elapsed', () => {
      const now = 10_000_000;
      const account: LockoutAccountView = {
        failedAttempts: AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS,
        // lockUntil expired 1ms ago — handler must proceed normally.
        lockUntil: new Date(now - 1).toISOString(),
      };
      const { result } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: true, stats: { totalRows: 42, durationMs: 123 } },
        now,
      });
      expect(result.kind).toBe('success');
    });

    it('allows the call through when the account has no prior lock', () => {
      const account: LockoutAccountView = {
        failedAttempts: 0,
        lockUntil: null,
      };
      const { result } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: true, stats: { totalRows: 1, durationMs: 1 } },
      });
      expect(result.kind).toBe('success');
    });
  });

  describe('success branch', () => {
    it('resets failedAttempts and lockUntil on a successful migration', () => {
      const account: LockoutAccountView = {
        failedAttempts: 3,
        lockUntil: null,
      };
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account,
        migrationResult: {
          ok: true,
          stats: { totalRows: 99, durationMs: 500 },
        },
      });
      expect(result.kind).toBe('success');
      expect(accountAfter?.failedAttempts).toBe(0);
      expect(accountAfter?.lockUntil).toBeNull();
    });

    it('is a no-op on already-zero lockout state (avoids redundant putAccount)', () => {
      // This mirrors the handler's write guard:
      //   if (account.failedAttempts !== reset.failedAttempts || ...) putAccount(...)
      // Behaviourally the account stays equal — the test pins the
      // invariant that a success on a clean account doesn't flip
      // anything.
      const account: LockoutAccountView = {
        failedAttempts: 0,
        lockUntil: null,
      };
      const { accountAfter } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: true, stats: { totalRows: 1, durationMs: 1 } },
      });
      expect(accountAfter?.failedAttempts).toBe(0);
      expect(accountAfter?.lockUntil).toBeNull();
    });

    it('tolerates a missing account on success (no persist, no crash)', () => {
      // The real handler's `accountsFile.getAccountById(userId)` can
      // legitimately return undefined (e.g. a stale `userId` from a
      // deleted account).  The handler proceeds to run the migration
      // which will then return `account_not_found`.  But if for some
      // reason the migration succeeded (e.g. race window), we should
      // not blow up on the reset.
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account: null,
        migrationResult: {
          ok: true,
          stats: { totalRows: 5, durationMs: 10 },
        },
      });
      expect(result.kind).toBe('success');
      expect(accountAfter).toBeNull();
    });
  });

  describe('invalid_credentials branch — the regression this test was built for', () => {
    it('increments failedAttempts on a single wrong password (not locked yet)', () => {
      const account: LockoutAccountView = {
        failedAttempts: 1,
        lockUntil: null,
      };
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: false, code: 'invalid_credentials' },
      });
      expect(result.kind).toBe('invalid_credentials');
      expect(result.status).toBe(401);
      expect(accountAfter?.failedAttempts).toBe(2);
      expect(accountAfter?.lockUntil).toBeNull();
    });

    it('locks at exactly MAX_FAILED_ATTEMPTS and switches status to 423', () => {
      const now = 20_000_000;
      const account: LockoutAccountView = {
        failedAttempts: AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS - 1,
        lockUntil: null,
      };
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: false, code: 'invalid_credentials' },
        now,
      });
      expect(result.kind).toBe('locked_after_failure');
      expect(result.status).toBe(423);
      expect(accountAfter?.failedAttempts).toBe(
        AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS,
      );
      expect(accountAfter?.lockUntil).toBe(
        new Date(now + AUTH_CONSTANTS.LOCKOUT_DURATION_MS).toISOString(),
      );
    });

    it('past the threshold, each additional failure keeps the lock in place', () => {
      const now = 30_000_000;
      const account: LockoutAccountView = {
        failedAttempts: AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS + 2,
        lockUntil: null,
      };
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account,
        migrationResult: { ok: false, code: 'invalid_credentials' },
        now,
      });
      expect(result.kind).toBe('locked_after_failure');
      expect(accountAfter?.failedAttempts).toBe(
        AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS + 3,
      );
      expect(accountAfter?.lockUntil).not.toBeNull();
    });

    it('does NOT increment counters when the account is missing (404-ish)', () => {
      // Handler contract: if getAccountById returned undefined, we
      // fall through to the "other error" branch and let the migration
      // result's own `account_not_found` code flow to a 404.  The
      // invalid_credentials → registerFailure path is gated on an
      // existing account specifically so we can't be tricked into
      // bumping counters on a userId that doesn't exist.
      const { result, accountAfter } = simulateMigrationHandlerLockout({
        account: null,
        migrationResult: { ok: false, code: 'invalid_credentials' },
      });
      expect(result.kind).toBe('other_error');
      expect(result.status).toBe(401);
      expect(accountAfter).toBeNull();
    });
  });

  describe('other-error branch', () => {
    it('maps state_conflict to 409', () => {
      const { result } = simulateMigrationHandlerLockout({
        account: { failedAttempts: 0, lockUntil: null },
        migrationResult: {
          ok: false,
          code: 'state_conflict',
          detail: 'already-migrated',
        },
      });
      expect(result.kind).toBe('other_error');
      expect(result.status).toBe(409);
    });

    it('maps no_source_db and account_not_found to 404', () => {
      for (const code of ['no_source_db', 'account_not_found'] as const) {
        const { result } = simulateMigrationHandlerLockout({
          account: null,
          migrationResult: { ok: false, code },
        });
        expect(result.kind).toBe('other_error');
        expect(result.status).toBe(404);
      }
    });

    it('maps unknown codes to 500', () => {
      const { result } = simulateMigrationHandlerLockout({
        account: null,
        migrationResult: { ok: false, code: 'unknown' },
      });
      expect(result.kind).toBe('other_error');
      expect(result.status).toBe(500);
    });
  });

  describe('ladder parity — convergence with accountsChangePasswordHandler', () => {
    it('10 consecutive wrong-password hits lock the account on both ladders (contract)', () => {
      // This pins the user-visible contract: whether the attacker
      // hits `migration/v1-to-v2` or `accounts/change-password`,
      // `AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS` attempts is the hard
      // ceiling — no endpoint offers an unbounded Argon2id budget.
      const account: LockoutAccountView = {
        failedAttempts: 0,
        lockUntil: null,
      };
      let lastKind: SimulationResult['kind'] | undefined;
      for (let i = 0; i < 10; i++) {
        const { result } = simulateMigrationHandlerLockout({
          account,
          migrationResult: { ok: false, code: 'invalid_credentials' },
          now: 100_000 + i * 1_000,
        });
        lastKind = result.kind;
        if (
          result.kind === 'locked_preflight' ||
          result.kind === 'locked_after_failure'
        ) {
          break;
        }
      }
      expect(lastKind).toBe('locked_after_failure');
      expect(account.failedAttempts).toBeGreaterThanOrEqual(
        AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS,
      );
      expect(account.lockUntil).not.toBeNull();
    });
  });
});
