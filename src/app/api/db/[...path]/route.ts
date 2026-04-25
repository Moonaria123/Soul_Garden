import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  openDatabase,
  getDatabase,
  getDbPath,
  closeDatabase,
  isDatabaseOpen,
  startSessionCleanup,
} from '@/lib/db/connection';
import { releaseAllLibsqlSessionsBeforeDiskMigration } from '@/lib/db/migration-disk-guard';
import {
  flattenSessionOpenError,
  isNotadbOnFirstMigrationDDL,
  sessionOpenDbErrorCode,
  shouldExposeSessionOpenErrorDetail,
} from '@/lib/db/session-open-errors';
import { runMigrations } from '@/lib/db/migration';
import * as storage from '@/lib/db/storage-service';
import * as accountsFile from '@/lib/db/accounts-file';
import {
  runAtomicEntityRestore,
  type AtomicEntityRestorePayload,
} from '@/lib/db/restore-atomic';
import { verifyPassword } from '@/lib/crypto/password-hash';
import {
  deriveDbEncryptionKeyHex_v1_legacy,
  deriveDbEncryptionKeyHex_v2,
} from '@/lib/crypto/key-derivation-server';
import { secretFingerprint } from '@/lib/security/redact';
import {
  detectMigrationState,
  describeMigrationStatus,
  runV1ToV2Migration,
  runChangePassword,
  cleanupMidMigrationResidue,
  removeV1Backup,
  removeRekeyBackup,
  recoverFromBakOnly,
  recoverFromRekeyBak,
  ensureV2Marker,
  probeV2DbOpenable,
  repairFalseMigratedMarker,
  repairFalseV2MarkerAfterNotadbOnSchemaDdl,
  restoreActiveDbFromV1Backup,
} from '@/lib/db/migration-v2';
import { evaluateLockout, registerFailure, resetLockout } from '@/lib/auth/lockout';
// SU-088 · P0-C: delegated to the shared allow-list helper.
import { localhostGuard } from '@/lib/security/localhost-guard';
// SU-ITER-090a · R10 — slow down username enumeration even on loopback.
import { createRateLimiter } from '@/lib/security/rate-limit';
// SU-088 · P0-D: strict write whitelists + outbound sanitisation.
import {
  AccountCreateSchema,
  AccountProfileUpdateSchema,
  AccountChangePasswordSchema,
  AccountDeleteSchema,
  toPublicAccount,
  toLoginMaterial,
} from '@/lib/db/accounts-schema';
import type { StoredAccount } from '@/lib/db/accounts-file';
// SU-ITER-091-batch2 · code-C-3 + code-C-4 — route-helpers.ts and
// route-schemas.ts consolidate the previously-inlined body helpers
// and Zod schemas.  The dispatch table below reads purely from those
// modules; the handler bodies are kept small enough that the whole
// file stays well under the 800-line ceiling.
import {
  parseBody,
  readString,
  readField,
  requireField,
  zodErrorResponse,
  safeErrorResponse,
} from '@/lib/db/route-helpers';
import {
  ProviderUpsertBody,
  SetDefaultProviderBody,
  ProviderModelUpsertBody,
  EntityUpsertBody,
  SessionUpsertBody,
  SessionStateUpsertBody,
  MessageInsertBody,
  MessageBatchBody,
  UserProfileUpsertBody,
  DraftUpsertBody,
  RelationshipSnapshotUpsertBody,
  MemoryEventsBatchBody,
  MemoryFactsBatchBody,
  MemoryFactUpsertMergeBody,
  MemorySummariesBatchBody,
  OpenLoopsBatchBody,
  MemoryEmbeddingUpsertBody,
  MemoryEmbeddingsListBody,
  MemoryEmbeddingsDeleteForEntityBody,
  ConfigSetBody,
  RestoreEntityBody,
  BackupDeriveLegacyDekBody,
} from '@/lib/db/route-schemas';
import type { ZodType } from 'zod';

// ============================================================
// Unified Database API Routes
// All browser <-> server DB communication goes through here.
// Localhost-only; session-token authenticated.
//
// SU-ITER-091-batch2 · P3-02 — dispatch is now a `Map<route, handler>`
// instead of a 30+-entry if-else chain.  Benefits:
//   - O(1) route lookup (was O(n) linear scan)
//   - Every handler is independently testable
//   - The dispatch table itself is the single source of truth for
//     which routes require a DB session vs. accept anonymous calls.
//
// The file is partitioned into three sections:
//   §1  Public handlers (migration/* + session/*)    — no DB session
//   §2  Accounts handlers (accounts/*)               — no DB session
//   §3  DB-session handlers (providers/*, entities/*, memory/*, …)
//
// The POST entry point looks up a handler in the relevant map in that
// order; any unmatched route returns 404.  `session/open` is still
// handled inline because its control flow (migration probe ->
// password verify -> DEK derive -> token mint) would noisily split
// across callbacks.
//
// ------------------------------------------------------------
// SU-ITER-092 · RLX-CODE-02 — File-length exemption (accepted).
// ------------------------------------------------------------
// Current size: ~1365 lines · 58 handlers (9 Public + 5 Accounts
// + 42 DB + 1 inline `handleSessionOpen`).  This exceeds the
// architectural guideline of ≤ 800 lines per route file.
//
// Two rounds of Stage C Gate (4 reviewers each) found NO bugs
// inside this file; A3-HIGH-01 flagged only the line-count.  The
// user (2026-04-19) reviewed a cost/benefit analysis and chose to
// defer the split as R-093-04 "condition-triggered" rather than
// "delayed cleanup" because:
//
//   1. The file is already semantically modular.  Every handler
//      is a self-contained `const xxxHandler: Handler = ...`
//      exported via three Maps.  The POST entry point is only
//      69 lines of pure dispatch.  This is NOT a spaghetti file
//      that needs structural refactoring; a split would be a
//      pure "move" operation with no cohesion improvement.
//
//   2. The current test suite (48 files, 399 tests) does NOT
//      exercise the POST entry wiring directly — only two tests
//      re-implement handler logic (`lockout-ladder-migration-
//      v1-to-v2.test.ts`, `backup-derive-legacy-dek-schema.
//      test.ts`).  A safe split REQUIRES a route-level smoke
//      suite of ~180 tests (58 handlers × 3 scenarios: 200/
//      400/500).  That pre-work is a 2-3 day investment whose
//      only purpose is to enable a line-count fix.
//
//   3. This is a single-user loopback product with one active
//      developer.  The usual "file too big" pain points —
//      merge conflicts, reviewer context-switching across
//      independent teams — do not apply.  The in-file
//      `Ctrl+F handlerName` workflow is already optimal for
//      solo navigation.
//
//   4. Rate-limiter instances (`accountsGetLimiter`,
//      `deriveLegacyDekLimiter`) MUST stay module-singletons
//      across concurrent requests.  Splitting risks accidental
//      re-instantiation in child modules, a class of bug that
//      only manifests under load (no unit test can catch it).
//
//   5. SU-ITER-093's primary value (multi-user `.db`-per-user
//      architecture + v1 legacy cleanup) will necessarily
//      rewrite `withDb` / `getClientIp` / dispatch wiring.  A
//      split done NOW would be re-done then; a split done AS
//      PART OF the multi-user rewrite amortises protection-
//      test cost against feature work.
//
// CONDITION TRIGGERS — split MUST be executed if any of these
// occur (see ITERATION-LOG §SU-ITER-093 R-093-04 for details):
//
//   (a) SU-093 multi-user architecture lands and this file
//       grows past 1600 lines during the rewrite, OR
//   (b) a second permanent developer joins (merge-conflict
//       pressure becomes real), OR
//   (c) a single handler develops deep coupling (> 5 cross-
//       references) to other handlers in this file, OR
//   (d) `max-lines` or `max-lines-per-function` ESLint rule
//       is introduced with a numeric cap that blocks CI.
//
// Absent those triggers, this exemption stands and future
// reviewers should not re-open the question without new evidence.
// ============================================================

startSessionCleanup();

// SU-ITER-090a · R10 — per-process sliding-window limiter shared across
// every request served by this module.  Scope: `accounts/get` username
// lookups (pre-auth, returns salt → login material).  10 hits / minute
// per `${ip}:${username}` composite key is more than enough for the
// single legitimate user on a loopback binary while making brute-force
// username discovery expensive.
const ACCOUNTS_GET_RL_MAX = 10;
const ACCOUNTS_GET_RL_WINDOW_MS = 60_000;
const accountsGetLimiter = createRateLimiter({
  max: ACCOUNTS_GET_RL_MAX,
  windowMs: ACCOUNTS_GET_RL_WINDOW_MS,
  maxKeys: 2048,
});

// SU-ITER-091-batch3 — `backup/derive-legacy-dek` is strictly rate-
// limited because each successful hit costs one Argon2id password
// verification PLUS one PBKDF2 ×600k derivation.  5/min per
// `${ip}:${userId}` is more than enough for a legitimate user
// walking through a restore wizard (each attempt requires manual
// password entry) while making brute-force attempts against the
// password infeasibly slow.  The underlying account lockout ladder
// (see `lockout.ts`) still provides the authoritative guard; this
// limiter is a cheap layer in front that trips *before* Argon2id.
const BACKUP_DERIVE_LEGACY_DEK_RL_MAX = 5;
const BACKUP_DERIVE_LEGACY_DEK_RL_WINDOW_MS = 60_000;
const deriveLegacyDekLimiter = createRateLimiter({
  max: BACKUP_DERIVE_LEGACY_DEK_RL_MAX,
  windowMs: BACKUP_DERIVE_LEGACY_DEK_RL_WINDOW_MS,
  maxKeys: 2048,
});

function getClientIp(req: NextRequest): string {
  // R-093-03 — SU-ITER-093 residual-risk registry entry (see
  //   docs/ITERATION-LOG.md §SU-ITER-093 残差风险登记表 R-093-03).
  // SU-ITER-090a mini-Gate NIT — forwarding headers (`x-forwarded-for`,
  // `x-real-ip`) are set by the client and spoofable.  `localhostGuard`
  // only validates the TCP-level origin; it does not strip headers.  A
  // native-process attacker on localhost could otherwise rotate the
  // apparent IP with `curl -H 'x-forwarded-for: 1.2.3.N'` and bypass
  // the per-IP component of the rate-limit bucket.
  //
  // For this single-user loopback product we have no legitimate reverse
  // proxy in front of the app, so forwarding headers are ignored by
  // default.  If a downstream deployment ever DOES put a trusted proxy
  // in front (e.g. Tauri / NAT hairpin) they can opt in via
  // `SU_TRUST_PROXY_HEADERS=1`.  Result: the composite key degrades to
  // `${sentinel}|${username}`, which still enforces the per-username
  // rate limit — the intended security property.
  if (process.env.SU_TRUST_PROXY_HEADERS === '1') {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) {
      // `String.prototype.split` always returns a non-empty array, so
      // `[0]` is never undefined at runtime — but the type system can't
      // see that.  `?? ''` keeps the narrowing tidy for `no-non-null-
      // assertion: error` (SU-ITER-092-batch3 · A4-MEDIUM cleanup).
      const first = fwd.split(',')[0] ?? '';
      return first.trim();
    }
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return '127.0.0.1';
}

function getSessionToken(req: NextRequest): string | null {
  return req.cookies.get('su_db_session')?.value ?? req.headers.get('x-db-session') ?? null;
}

function withDb(req: NextRequest): { db: ReturnType<typeof getDatabase>; error?: NextResponse } {
  const token = getSessionToken(req);
  if (!token) return { db: null, error: NextResponse.json({ error: 'No session' }, { status: 401 }) };
  const db = getDatabase(token);
  if (!db) return { db: null, error: NextResponse.json({ error: 'Session expired' }, { status: 401 }) };
  return { db };
}

// ============================================================
// Handler types
// ============================================================

type DB = NonNullable<ReturnType<typeof getDatabase>>;

/** Public / accounts handler — no DB session required. */
type PublicHandler = (ctx: {
  req: NextRequest;
  body: unknown;
  route: string;
}) => Promise<NextResponse> | NextResponse;

/** DB-session handler — `db` is guaranteed non-null. */
type DbHandler = (ctx: {
  db: DB;
  body: unknown;
  route: string;
}) => Promise<NextResponse> | NextResponse;

// ============================================================
// §1 · Public handlers (migration + session)
// ============================================================

const migrationStatusHandler: PublicHandler = () => {
  // SU-ITER-089 · P1-1 · B8-8 — extended startup report.  `state` is
  // the authoritative flag the UI routes on; auxiliary booleans let a
  // polished UI surface "you can wipe the old backup" and "we
  // recovered the pre-migration copy after a crash" without an extra
  // round trip.
  return NextResponse.json(describeMigrationStatus());
};

// SU-ITER-092-batch3 · A1-N4 — registered under `PUBLIC_HANDLERS`
// because `StartupHealthCheck` (the UI that invokes these) mounts on
// the pre-auth `(auth)` layout and the user has no DB session when
// they click "clean up backup".  Blast radius bounded to:
//   1. Deletion targets are inert encrypted backup copies
//      (`.bak-v1` / `.bak-rekey`); the active v2 `.db` is never
//      touched, and these backups carry zero plaintext secret.
//   2. `fs.existsSync` short-circuit: if the backup is already absent,
//      the call is a no-op (no "wrong state" exception to observe).
// Residual: a loopback process can delete a migrated user's legacy
// backup and silently remove the recovery path they might later want
// to exercise.  Registered in SU-ITER-093 (R-093-05) for the
// multi-user rearchitecture Gate to revisit alongside the session-
// token rollout (at that point these endpoints can move to a
// session-gated bucket without breaking the auth-layout UI, because
// `StartupHealthCheck` will be moved into the authenticated shell).
const migrationCleanupV1: PublicHandler = () => {
  const result = removeV1Backup();
  if (result.ok) {
    console.info('[db-api] v1 backup removed by user');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    {
      error: 'cleanup_failed',
      ...(process.env.NODE_ENV === 'development' ? { detail: result.detail } : {}),
    },
    { status: 500 },
  );
};

const migrationCleanupRekey: PublicHandler = () => {
  const result = removeRekeyBackup();
  if (result.ok) {
    console.info('[db-api] rekey backup removed by user');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    {
      error: 'cleanup_failed',
      ...(process.env.NODE_ENV === 'development' ? { detail: result.detail } : {}),
    },
    { status: 500 },
  );
};

const migrationRecoverFromBak: PublicHandler = () => {
  const pre = detectMigrationState();
  if (pre !== 'bak-only') {
    return NextResponse.json({ error: 'state_conflict', state: pre }, { status: 409 });
  }
  const result = recoverFromBakOnly();
  if (result.ok) {
    console.info('[db-api] recovered from bak-only');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    {
      error: 'recover_failed',
      ...(process.env.NODE_ENV === 'development' ? { detail: result.detail } : {}),
    },
    { status: 500 },
  );
};

const migrationRecoverFromRekeyBak: PublicHandler = () => {
  const pre = detectMigrationState();
  if (pre !== 'rekey-bak-only') {
    return NextResponse.json({ error: 'state_conflict', state: pre }, { status: 409 });
  }
  const result = recoverFromRekeyBak();
  if (result.ok) {
    console.info('[db-api] recovered from rekey-bak-only');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    {
      error: 'recover_failed',
      ...(process.env.NODE_ENV === 'development' ? { detail: result.detail } : {}),
    },
    { status: 500 },
  );
};

/**
 * Remove a spurious `.db-v2-marker` when the file is still v1-openable but v2
 * is not — fixes false-migrated loops (`NOTADB` on DDL + `state_conflict`).
 * Same lockout ladder as `migration/v1-to-v2`.
 */
const migrationRepairFalseMarkerHandler: PublicHandler = async ({ body }) => {
  const userId = readString(body, 'userId');
  const password = readString(body, 'password');
  if (!userId || !password) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const account = accountsFile.getAccountById(userId);
  if (!account) {
    return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
  }

  const lock = evaluateLockout(account);
  if (lock.locked) {
    return NextResponse.json(
      { error: 'account_locked', remainingMinutes: lock.remainingMinutes },
      { status: 423 },
    );
  }

  let valid = false;
  try {
    valid = await verifyPassword(password, account.passwordHash);
  } catch (err) {
    console.error('[db-api] migration/repair-false-marker verify failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'verify_failed' }, { status: 500 });
  }

  if (!valid) {
    const progression = registerFailure(account);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    const wFail = putAccountOr500(account);
    if (wFail) return wFail;
    return NextResponse.json(
      {
        error: progression.locked ? 'account_locked' : 'invalid_credentials',
        remaining: progression.remaining,
      },
      { status: progression.locked ? 423 : 401 },
    );
  }

  if (account.failedAttempts !== 0 || account.lockUntil) {
    const reset = resetLockout();
    account.failedAttempts = reset.failedAttempts;
    account.lockUntil = reset.lockUntil;
    const w2 = putAccountOr500(account);
    if (w2) return w2;
  }

  releaseAllLibsqlSessionsBeforeDiskMigration();

  const result = await repairFalseMigratedMarker({ password, saltHex: account.salt });
  if (result.ok) {
    console.info(
      `[db-api] migration/repair-false-marker ok user=${secretFingerprint(userId)}`,
    );
    return migrationMutationJsonResponse({ ok: true });
  }

  const status =
    result.code === 'unlink_failed' ? 500
      : 409;
  return migrationMutationJsonResponse(
    {
      error: 'repair_failed',
      reason: result.code,
      ...(result.detail !== undefined
        ? { detail: String(result.detail).slice(0, 800) }
        : {}),
    },
    { status },
  );
};

/**
 * Copy `soul-upload.db.bak-v1` over the active `.db` and strip `.db-v2-marker`
 * so the user can re-run v1→v2. Password-gated; closes all libsql sessions first.
 */
const migrationRestoreV1BackupOverActiveHandler: PublicHandler = async ({ body }) => {
  const userId = readString(body, 'userId');
  const password = readString(body, 'password');
  if (!userId || !password) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const account = accountsFile.getAccountById(userId);
  if (!account) {
    return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
  }

  const lock = evaluateLockout(account);
  if (lock.locked) {
    return NextResponse.json(
      { error: 'account_locked', remainingMinutes: lock.remainingMinutes },
      { status: 423 },
    );
  }

  let valid = false;
  try {
    valid = await verifyPassword(password, account.passwordHash);
  } catch (err) {
    console.error('[db-api] migration/restore-v1-backup-over-active verify failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'verify_failed' }, { status: 500 });
  }

  if (!valid) {
    const progression = registerFailure(account);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    const wFail = putAccountOr500(account);
    if (wFail) return wFail;
    return NextResponse.json(
      {
        error: progression.locked ? 'account_locked' : 'invalid_credentials',
        remaining: progression.remaining,
      },
      { status: progression.locked ? 423 : 401 },
    );
  }

  if (account.failedAttempts !== 0 || account.lockUntil) {
    const reset = resetLockout();
    account.failedAttempts = reset.failedAttempts;
    account.lockUntil = reset.lockUntil;
    const w2 = putAccountOr500(account);
    if (w2) return w2;
  }

  releaseAllLibsqlSessionsBeforeDiskMigration();
  const result = restoreActiveDbFromV1Backup();
  if (result.ok) {
    console.info(
      `[db-api] migration/restore-v1-backup-over-active ok user=${secretFingerprint(userId)}`,
    );
    return migrationMutationJsonResponse({ ok: true });
  }

  const status = result.detail === 'no_bak_v1' ? 404 : 500;
  return migrationMutationJsonResponse(
    {
      error: 'restore_failed',
      reason: result.detail,
      ...(shouldExposeSessionOpenErrorDetail() && result.detail !== 'no_bak_v1'
        ? { detail: result.detail }
        : {}),
    },
    { status },
  );
};

// SU-ITER-092-batch3 · A1-C1 close-out — lockout ladder parity.
//
// Pre-batch3, `migrationV1ToV2Handler` was the one authenticating
// endpoint that did NOT run through the `evaluateLockout` /
// `registerFailure` ladder shared by `session/open`,
// `accountsChangePasswordHandler`, and the V1 backup DEK derivation
// endpoint.  During the `needs-migration` window (arbitrarily long —
// the user might not migrate for days), repeated wrong-password hits
// only paid the Argon2id cost and left no audit trail on the account
// row.  Although the file-system state guard in `runV1ToV2Migration`
// meant no secrets could leak, the asymmetry was a real gap: a
// brute-force campaign could lock out every OTHER endpoint of the
// same account while never touching counters here.
//
// Fix: mirror `accountsChangePasswordHandler`'s exact pattern —
// evaluate lockout before running the migration, register failures
// on bad credentials, and reset on success.  Account resolution is
// optional (caller might supply a non-existent `userId`) so the
// guard block is conditional, but once an account is resolved the
// ladder is mandatory.
const migrationV1ToV2Handler: PublicHandler = async ({ body }) => {
  const state = detectMigrationState();
  if (state === 'mid-migration') cleanupMidMigrationResidue();
  const userId = readString(body, 'userId');
  const password = readString(body, 'password');
  if (!userId || !password) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Resolve the account BEFORE running the migration so we can front-
  // load the lockout check.  Absent accounts fall through to the
  // existing 404 below so we don't leak the "this userId exists"
  // signal any differently than before.
  const account = accountsFile.getAccountById(userId);
  if (account) {
    const lock = evaluateLockout(account);
    if (lock.locked) {
      return NextResponse.json(
        { error: 'account_locked', remainingMinutes: lock.remainingMinutes },
        { status: 423 },
      );
    }
  }

  releaseAllLibsqlSessionsBeforeDiskMigration();

  const result = await runV1ToV2Migration({ userId, password });

  if (result.ok) {
    if (account) {
      const reset = resetLockout();
      if (
        account.failedAttempts !== reset.failedAttempts ||
        account.lockUntil !== reset.lockUntil
      ) {
        account.failedAttempts = reset.failedAttempts;
        account.lockUntil = reset.lockUntil;
        accountsFile.putAccount(account);
      }
    }
    return migrationMutationJsonResponse({ ok: true, stats: result.stats });
  }

  if (result.code === 'invalid_credentials' && account) {
    const progression = registerFailure(account);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    accountsFile.putAccount(account);
    return migrationMutationJsonResponse(
      {
        error: progression.locked ? 'account_locked' : 'invalid_credentials',
        remaining: progression.remaining,
      },
      { status: progression.locked ? 423 : 401 },
    );
  }

  const status = result.code === 'invalid_credentials' ? 401
    : result.code === 'state_conflict' ? 409
    : result.code === 'no_source_db' || result.code === 'account_not_found' ? 404
    : 500;
  // `state_conflict.detail` is the current MigrationState (e.g. `migrated`); safe to
  // expose in production so the wizard can pivot to "already upgraded → retry login"
  // without treating it as a hard failure.
  return migrationMutationJsonResponse(
    {
      error: result.code,
      ...(result.detail !== undefined &&
      (result.code === 'state_conflict' || process.env.NODE_ENV === 'development')
        ? { detail: result.detail }
        : {}),
    },
    { status },
  );
};

const sessionCloseHandler: PublicHandler = ({ req }) => {
  const token = getSessionToken(req);
  if (token) closeDatabase(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete('su_db_session');
  return response;
};

const sessionStatusHandler: PublicHandler = ({ req }) => {
  // SU-ITER-090c · P2-02 — uniform Map lookup regardless of whether the
  // caller supplied a cookie so `isDatabaseOpen('')` masks the timing
  // delta between "no cookie" and "cookie but session evicted".
  const token = getSessionToken(req);
  const active = isDatabaseOpen(token ?? '');
  return NextResponse.json({ active });
};

/**
 * Persist account lockout / reset; failures here used to throw into
 * `safeErrorResponse` with opaque English messages and no stable `error` code.
 */
function putAccountOr500(account: StoredAccount): NextResponse | null {
  try {
    accountsFile.putAccount(account);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db-api] accounts.json write failed:', msg);
    return NextResponse.json(
      {
        error: 'accounts_write_failed',
        ...(process.env.NODE_ENV === 'development' ? { detail: msg.slice(0, 500) } : {}),
      },
      { status: 500 },
    );
  }
}

/**
 * JSON response after `releaseAllLibsqlSessionsBeforeDiskMigration()` on migration/repair paths.
 * Clears `su_db_session` so the browser cannot reuse a token whose in-memory
 * session map entry was already evicted (single-user loopback product).
 */
function migrationMutationJsonResponse(
  body: Record<string, unknown>,
  init?: { status?: number },
): NextResponse {
  const res = NextResponse.json(body, init);
  res.cookies.delete('su_db_session');
  return res;
}

async function handleSessionOpen(req: NextRequest, body: unknown): Promise<NextResponse> {
  // SU-ITER-089 · P1-1 (B8-2) · v2 session/open contract.
  //
  // Wire change: the browser now sends `{ userId, password }` ONLY.
  // The server derives the DB DEK itself via key-derivation-server
  // (domain-separated PBKDF2 over the account salt).  This closes the
  // SU-088 P0-D "salt-on-username" residual — callers never see salt
  // except in the success response, and they only use that salt to
  // derive the **Client KEK** (AES-GCM for API-key/backup payloads),
  // not the DB DEK.
  //
  // Audit logging NEVER records `salt`, `password`, or the raw DEK.
  // Session tokens are logged as short fingerprints only.
  //
  // Migration gate: if the on-disk db is still v1, refuse to open and
  // tell the caller to run the migration wizard first.  This is a
  // soft 409 — the browser is expected to handle it by pivoting UI to
  // the MigrationWizard component rather than surfacing an error.
  //
  // Self-heal (Stage B Gate · code-C-1 / sec-C-1): `needs-migration`
  // can also arise from a committed v2 db that lost its marker sentinel
  // (disk-full / permission flip / crash between rename-3 and marker
  // write).  Before returning 409 we probe the current .db with the v2
  // DEK derived from the supplied credentials; if it opens cleanly the
  // db is actually v2 and we just need to place the marker.
  const initialState = detectMigrationState();
  if (initialState === 'mid-migration') cleanupMidMigrationResidue();

  const userId = readString(body, 'userId');
  const password = readString(body, 'password');
  if (!userId || !password) {
    return NextResponse.json(
      { error: 'Missing userId or password' },
      { status: 400 },
    );
  }

  const account = accountsFile.getAccountById(userId);
  if (!account) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Evict every in-process libsql handle before any migration probe touches
  // `soul-upload.db` — same contract as `migration/restore-v1-backup-over-
  // active` and `migration/v1-to-v2` after SU-093 migration-deadlock fix.
  try {
    releaseAllLibsqlSessionsBeforeDiskMigration();
  } catch {
    /* best-effort — must not block login on close errors */
  }

  const migrationState = detectMigrationState();
  if (migrationState === 'needs-migration') {
    // Marker-missing self-heal attempt.  We deliberately do NOT mutate
    // lockout counters here — the probe is pre-auth and a wrong-password
    // path falls through to the normal 409 `migration_required` which
    // the browser then routes to the wizard.
    const probe = await probeV2DbOpenable({ password, saltHex: account.salt });
    if (probe.ok) {
      const marker = ensureV2Marker();
      if (marker.ok) {
        console.info(
          `[db-api] session/open self-healed missing marker user=${secretFingerprint(userId)}`,
        );
      } else {
        console.warn(`[db-api] session/open marker self-heal failed: ${marker.detail}`);
        return migrationMutationJsonResponse({ error: 'migration_required' }, { status: 409 });
      }
    } else {
      return migrationMutationJsonResponse({ error: 'migration_required' }, { status: 409 });
    }
  }

  const lock = evaluateLockout(account);
  if (lock.locked) {
    return NextResponse.json(
      {
        error: 'account_locked',
        lockUntil: account.lockUntil,
        remainingMinutes: lock.remainingMinutes,
      },
      { status: 423 },
    );
  }
  if (account.lockUntil) {
    const reset = resetLockout();
    account.failedAttempts = reset.failedAttempts;
    account.lockUntil = reset.lockUntil;
    const w0 = putAccountOr500(account);
    if (w0) return w0;
  }

  let valid = false;
  try {
    valid = await verifyPassword(password, account.passwordHash);
  } catch (err) {
    console.error('[db-api] session/open password verify failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'verify_failed' }, { status: 500 });
  }

  if (!valid) {
    const progression = registerFailure(account);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    const wFail = putAccountOr500(account);
    if (wFail) return wFail;
    return NextResponse.json(
      {
        error: progression.locked ? 'account_locked' : 'invalid_credentials',
        failedAttempts: progression.failedAttempts,
        remaining: progression.remaining,
        lockUntil: progression.lockUntil ?? undefined,
      },
      { status: progression.locked ? 423 : 401 },
    );
  }

  if (account.failedAttempts !== 0 || account.lockUntil) {
    const reset = resetLockout();
    account.failedAttempts = reset.failedAttempts;
    account.lockUntil = reset.lockUntil;
    const w2 = putAccountOr500(account);
    if (w2) return w2;
  }

  // Marker can exist while `soul-upload.db` is still v1, corrupt, or from another
  // install — `detectMigrationState() === 'migrated'` would skip the pre-auth
  // `needs-migration` probe.  Fail fast with 409 so the client pivots to the
  // migration wizard instead of surfacing SQLITE_NOTADB on first DDL.
  //
  // SU-ITER-093 follow-up: when the v2 probe fails, run the same false-marker
  // repair used by `migration/repair-false-marker` before giving up.  That
  // closes the wizard deadlock where `session/open` → migration_required,
  // `migration/v1-to-v2` → state_conflict(migrated), and repair would have
  // stripped the marker in a second round-trip.  If repair reports
  // `v2_already_openable` while the first probe failed, retry the probe a few
  // times (Windows / libsql transient file locks have been observed in the
  // field) so a healthy v2 file can still open in one login request.
  if (detectMigrationState() === 'migrated') {
    let probe = await probeV2DbOpenable({ password, saltHex: account.salt });
    if (!probe.ok) {
      const repair = await repairFalseMigratedMarker({ password, saltHex: account.salt });
      if (repair.ok) {
        console.info(
          `[db-api] session/open auto-removed false v2 marker user=${secretFingerprint(userId)}`,
        );
        return migrationMutationJsonResponse(
          {
            error: 'migration_required',
            reason: 'false_migrated_marker_removed_auto',
          },
          { status: 409 },
        );
      }
      if (repair.code === 'v2_already_openable') {
        for (let attempt = 0; attempt < 5 && !probe.ok; attempt++) {
          await new Promise<void>((r) => setTimeout(r, 80 + attempt * 100));
          probe = await probeV2DbOpenable({ password, saltHex: account.salt });
        }
      }
    }
    if (!probe.ok) {
      console.warn('[db-api] session/open migrated-state v2 probe failed:', probe.detail);
      return migrationMutationJsonResponse(
        {
          error: 'migration_required',
          reason: 'db_not_v2_openable',
          ...(shouldExposeSessionOpenErrorDetail() ? { detail: probe.detail } : {}),
        },
        { status: 409 },
      );
    }
  }

  let dek: Buffer;
  try {
    dek = await deriveDbEncryptionKeyHex_v2(password, account.salt);
  } catch (err) {
    console.error('[db-api] session/open DEK derivation failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'derive_failed' }, { status: 500 });
  }

  const token = uuidv4();
  try {
    const db = openDatabase(token, dek, userId);
    await runMigrations(db);
    console.info(
      `[db-api] session/open ok user=${secretFingerprint(userId)} token=${token.slice(0, 8)}…`,
    );
    const response = NextResponse.json({ ok: true, token, salt: account.salt });
    response.cookies.set('su_db_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 2,
    });
    return response;
  } catch (err) {
    const flat = flattenSessionOpenError(err);
    const logCode = flat.code;
    const logMsg = flat.message;

    if (isNotadbOnFirstMigrationDDL(err)) {
      console.warn(
        `[db-api] session/open NOTADB on schema_migrations DDL; suggesting migration wizard driverCode=${logCode}`,
      );
      try {
        closeDatabase(token);
      } catch {
        /* evict half-open session before disk probes / marker repair */
      }
      try {
        releaseAllLibsqlSessionsBeforeDiskMigration();
      } catch {
        /* best-effort */
      }

      if (detectMigrationState() === 'migrated') {
        const stripAfterNotadb = await repairFalseV2MarkerAfterNotadbOnSchemaDdl({
          password,
          saltHex: account.salt,
        });
        if (stripAfterNotadb.ok) {
          console.info(
            `[db-api] session/open NOTADB self-heal: stripped v2 marker after schema_migrations DDL failure ` +
            `user=${secretFingerprint(userId)}`,
          );
          return migrationMutationJsonResponse(
            {
              error: 'migration_required',
              reason: 'false_migrated_marker_removed_auto',
            },
            { status: 409 },
          );
        }
        const repair = await repairFalseMigratedMarker({ password, saltHex: account.salt });
        if (repair.ok) {
          console.info(
            `[db-api] session/open NOTADB self-heal (classic false marker) user=${secretFingerprint(userId)}`,
          );
          return migrationMutationJsonResponse(
            {
              error: 'migration_required',
              reason: 'false_migrated_marker_removed_auto',
            },
            { status: 409 },
          );
        }
      }

      return migrationMutationJsonResponse(
        {
          error: 'migration_required',
          reason: 'notadb_on_migration_ddl',
          ...(shouldExposeSessionOpenErrorDetail()
            ? { detail: logMsg.slice(0, 1200), ...(logCode ? { driverCode: logCode } : {}) }
            : {}),
        },
        { status: 409 },
      );
    }

    const apiError = sessionOpenDbErrorCode(err);
    console.error(
      `[db-api] session/open db failed: ${apiError} driverCode=${logCode} message=${logMsg}`,
    );
    if (process.env.NODE_ENV === 'development') {
      try {
        console.error('[db-api] session/open db path:', getDbPath());
      } catch {
        /* ignore */
      }
    }
    closeDatabase(token);
    const status =
      apiError === 'database_locked' ? 503
        : 500;
    const expose = shouldExposeSessionOpenErrorDetail();
    // Localhost-only app: in development (or SU_DEV_SESSION_OPEN_DETAIL=1) include
    // machine-readable detail so Network tab shows the real libsql/sqlite message.
    return NextResponse.json(
      {
        error: apiError,
        ...(expose
          ? {
              detail: logMsg.slice(0, 1200),
              ...(logCode ? { driverCode: logCode } : {}),
            }
          : {}),
      },
      { status },
    );
  }
}

// ============================================================
// §2 · Accounts handlers
// ============================================================

const accountsListHandler: PublicHandler = () => {
  return NextResponse.json(
    accountsFile.getAllAccounts().map(toPublicAccount),
  );
};

const accountsGetHandler: PublicHandler = ({ req, body, route }) => {
  const username = readString(body, 'username');
  if (username && username.length > 0) {
    // SU-ITER-090a · R10 — rate-limit username lookups to blunt
    // enumeration.  Lowercased so `Alice` and `alice` share a bucket.
    const ip = getClientIp(req);
    const rlKey = `${ip}|${username.toLowerCase()}`;
    const rl = accountsGetLimiter.check(rlKey);
    if (!rl.allowed) {
      const retryAfter = Math.ceil(rl.resetMs / 1000);
      console.warn(
        `[db-api] ${route} username rate-limited ip=${ip} ` +
        `user=${secretFingerprint(username)} retryAfter=${retryAfter}s`,
      );
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSec: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
    const account = accountsFile.getAccountByUsername(username);
    return NextResponse.json(account ? toLoginMaterial(account) : null);
  }
  const id = readString(body, 'id');
  if (id && id.length > 0) {
    // SU-ITER-092-batch3 · A1-N2 — `key=id` lookups were previously
    // unlimited.  Although the response shape (`toPublicAccount`,
    // no salt/hash) is narrower than the username path, an attacker
    // can still grind a UUID space to enumerate existence; the same
    // per-IP + per-lookup-key ladder applies.  We reuse the existing
    // `accountsGetLimiter` (shared bucket across both sub-paths is
    // intentional — a bursty attacker switching between `key=username`
    // and `key=id` should still feel the combined ceiling).
    const ip = getClientIp(req);
    const rlKey = `${ip}|id:${id}`;
    const rl = accountsGetLimiter.check(rlKey);
    if (!rl.allowed) {
      const retryAfter = Math.ceil(rl.resetMs / 1000);
      console.warn(
        `[db-api] ${route} id rate-limited ip=${ip} ` +
        `id=${secretFingerprint(id)} retryAfter=${retryAfter}s`,
      );
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSec: retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
    const account = accountsFile.getAccountById(id);
    return NextResponse.json(account ? toPublicAccount(account) : null);
  }
  return NextResponse.json(null);
};

const accountsPutHandler: PublicHandler = ({ body, route }) => {
  const bodyId = readString(body, 'id');
  const existing = bodyId ? accountsFile.getAccountById(bodyId) : undefined;
  if (existing) {
    const parsed = AccountProfileUpdateSchema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error, route);
    const next: StoredAccount = {
      ...existing,
      ...(parsed.data.username ? { username: parsed.data.username } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email ?? undefined } : {}),
    };
    accountsFile.putAccount(next);
    return NextResponse.json({ ok: true });
  }

  if (!accountsFile.canCreateOrUpdateAccount(bodyId ?? '')) {
    return NextResponse.json(
      { error: 'single_user_mode', message: 'This build supports a single local user. Remove the existing account first.' },
      { status: 409 },
    );
  }
  const parsed = AccountCreateSchema.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const created: StoredAccount = {
    id: parsed.data.id,
    username: parsed.data.username,
    passwordHash: parsed.data.passwordHash,
    salt: parsed.data.salt,
    email: parsed.data.email,
    failedAttempts: 0,
    lockUntil: null,
    createdAt: parsed.data.createdAt,
  };
  accountsFile.putAccount(created);
  return NextResponse.json({ ok: true });
};

const accountsChangePasswordHandler: PublicHandler = async ({ body, route }) => {
  const parsed = AccountChangePasswordSchema.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);

  const account = accountsFile.getAccountById(parsed.data.id);
  if (!account) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }
  const lock = evaluateLockout(account);
  if (lock.locked) {
    return NextResponse.json(
      { error: 'account_locked', remainingMinutes: lock.remainingMinutes },
      { status: 423 },
    );
  }

  const result = await runChangePassword({
    userId: parsed.data.id,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });

  if (result.ok) {
    const latest = accountsFile.getAccountById(parsed.data.id);
    if (latest) {
      const reset = resetLockout();
      if (latest.failedAttempts !== reset.failedAttempts || latest.lockUntil !== reset.lockUntil) {
        latest.failedAttempts = reset.failedAttempts;
        latest.lockUntil = reset.lockUntil;
        accountsFile.putAccount(latest);
      }
    }
    console.info(
      `[db-api] change-password ok user=${secretFingerprint(parsed.data.id)} ` +
      `rows=${result.stats.totalRows} ms=${result.stats.durationMs}`,
    );
    return NextResponse.json({ ok: true, stats: result.stats });
  }

  if (result.code === 'invalid_credentials') {
    const progression = registerFailure(account);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    accountsFile.putAccount(account);
    return NextResponse.json(
      {
        error: progression.locked ? 'account_locked' : 'invalid_credentials',
        remaining: progression.remaining,
      },
      { status: progression.locked ? 423 : 401 },
    );
  }

  const status = result.code === 'weak_password' ? 400
    : result.code === 'state_conflict' ? 409
    : result.code === 'account_not_found' ? 404
    : 500;
  return NextResponse.json(
    {
      error: result.code,
      ...(result.detail !== undefined &&
      (result.code === 'state_conflict' || process.env.NODE_ENV === 'development')
        ? { detail: result.detail }
        : {}),
    },
    { status },
  );
};

const accountsDeleteHandler: PublicHandler = ({ body, route }) => {
  const parsed = AccountDeleteSchema.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  accountsFile.deleteAccount(parsed.data.id);
  return NextResponse.json({ ok: true });
};

// ============================================================
// §2b · Backup / V1 compatibility handler
// ============================================================

/**
 * SU-ITER-091-batch3 — derive a one-shot V1-era payload DEK for
 * decrypting a V1 backup from a post-migration install.
 *
 * Why this endpoint exists
 * ------------------------
 * Backups written on a pre-migration (v1 KDF) install had their
 * payload encrypted with a DEK derived via
 * `deriveDbEncryptionKeyHex_v1_legacy(password, account.salt)`.
 * After migration-v2 rekeys the DB, the browser's session DEK is
 * v2 and can no longer decrypt those files.  This endpoint accepts
 * the user's password (re-entered in the restore dialog), verifies
 * it against the account record, derives the legacy DEK, and
 * returns the hex string.  The browser uses it in a single
 * `decryptPayloadWithDekHex` call and discards it immediately.
 *
 * Security posture
 * ----------------
 * - `localhostGuard` applied at the POST entry (same as every
 *   other handler in this module).
 * - Per-(ip, userId) rate limit @ 5/min trips before Argon2id.
 * - Uses the shared account lockout ladder
 *   (`evaluateLockout` / `registerFailure` / `resetLockout`), so
 *   attackers cannot bypass the session/open lockout by brute-
 *   forcing this endpoint instead.
 * - The server never retains `password` beyond Argon2id
 *   verification.  The derived DEK is returned as a hex **string**
 *   (not a Buffer) in the response body and then falls out of
 *   scope — JS strings are immutable and cannot be explicitly
 *   zeroised; this residual-in-V8-heap risk is documented and
 *   accepted in `key-derivation-server.ts::deriveDbEncryptionKeyHex_v1_legacy`
 *   JSDoc (SU-093 deprecation cleanup).  No `password` / `dekHex`
 *   is ever written to logs.
 * - `saltHex` is read from the account record on the server; the
 *   client cannot supply it (the body schema is `.strict()`).
 *   This closes the "attacker-controlled salt" surface: a request
 *   carrying a bogus salt would otherwise derive a DEK of their
 *   choosing from the victim's password hash — harmless if the
 *   password is wrong, but eliminating the vector is still
 *   preferable.
 *
 * @returns `{ ok: true, dekHex, saltHex }` on success.  `saltHex`
 *   is echoed so the client can cross-check against the manifest's
 *   `derivation.saltHex` (when present).
 */
const backupDeriveLegacyDekHandler: PublicHandler = async ({ req, body, route }) => {
  const parsed = BackupDeriveLegacyDekBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const { userId, password } = parsed.data;

  const ip = getClientIp(req);
  const rlKey = `${ip}|${userId}`;
  const rl = deriveLegacyDekLimiter.check(rlKey);
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.resetMs / 1000);
    console.warn(
      `[db-api] ${route} rate-limited ip=${ip} ` +
      `user=${secretFingerprint(userId)} retryAfter=${retryAfter}s`,
    );
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec: retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const account = accountsFile.getAccountById(userId);
  if (!account) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const lock = evaluateLockout(account);
  if (lock.locked) {
    return NextResponse.json(
      {
        error: 'account_locked',
        lockUntil: account.lockUntil,
        remainingMinutes: lock.remainingMinutes,
      },
      { status: 423 },
    );
  }

  let valid = false;
  try {
    valid = await verifyPassword(password, account.passwordHash);
  } catch (err) {
    console.error(
      `[db-api] ${route} password verify failed:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'verify_failed' }, { status: 500 });
  }

  if (!valid) {
    const progression = registerFailure(account);
    account.failedAttempts = progression.failedAttempts;
    account.lockUntil = progression.lockUntil;
    accountsFile.putAccount(account);
    return NextResponse.json(
      {
        error: progression.locked ? 'account_locked' : 'invalid_credentials',
        failedAttempts: progression.failedAttempts,
        remaining: progression.remaining,
        lockUntil: progression.lockUntil ?? undefined,
      },
      { status: progression.locked ? 423 : 401 },
    );
  }

  if (account.failedAttempts !== 0 || account.lockUntil) {
    const reset = resetLockout();
    account.failedAttempts = reset.failedAttempts;
    account.lockUntil = reset.lockUntil;
    accountsFile.putAccount(account);
  }

  // `deriveDbEncryptionKeyHex_v1_legacy` already returns a hex
  // string (see its JSDoc for why a Buffer is not used here).  The
  // hex string is immutable and therefore not zeroisable; this is
  // the same residual risk accepted in `runV1ToV2Migration`, which
  // runs the same derivation.  Tracked for SU-ITER-093 cleanup.
  let dekHex: string;
  try {
    dekHex = await deriveDbEncryptionKeyHex_v1_legacy(password, account.salt);
  } catch (err) {
    console.error(
      `[db-api] ${route} DEK derivation failed:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'derive_failed' }, { status: 500 });
  }

  console.info(
    `[db-api] backup/derive-legacy-dek ok user=${secretFingerprint(userId)}`,
  );
  return NextResponse.json({ ok: true, dekHex, saltHex: account.salt });
};

// ============================================================
// §3 · DB-session handlers
// ============================================================

/**
 * Tiny convenience factory: take a single-object upsert body Zod
 * schema + a storage-service function and produce a DB handler that
 * validates, calls the storage function, and returns `{ ok: true }`.
 * Replaces every `body as Parameters<typeof storage.X>[1]` smuggle
 * cast that existed in the previous if-chain (sec-C-B + code-C-2).
 */
// SU-ITER-091-batch2 · follow-up — use Zod's `ZodType<T>` so the
// inferred success branch carries the actual parsed shape.  The earlier
// draft constrained `data: never` structurally, which TS 5.7 refused to
// accept once the storage-service argument types started narrowing via
// `Parameters<typeof storage.X>[1]` — `never` is never a supertype.
function makeUpsertHandler<T>(
  schema: ZodType<T>,
  exec: (db: DB, data: T) => Promise<unknown>,
): DbHandler {
  return async ({ db, body, route }) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error, route);
    await exec(db, parsed.data);
    return NextResponse.json({ ok: true });
  };
}

/**
 * Batch-insert factory — parses the wrapper, then forwards the array.
 *
 * SU-ITER-091-batch2 · follow-up — the Zod array element schema
 * (`LeafRowWithId.passthrough()`) intentionally stops at
 * `{ id: string; [k: string]: unknown }` so we don't double-maintain
 * every column against Drizzle's `$inferInsert`.  That leaves the
 * handler with a `readonly unknown[]` shape which never overlaps with
 * the storage-service argument type without a bridging `unknown` cast.
 * The call site picks `R` through the `exec` signature, so the caller
 * gets the correct typed `rows` parameter while the cast here stays
 * quarantined to a single factory.
 */
function makeBatchHandler<T extends Record<string, readonly unknown[]>, R>(
  schema: ZodType<T>,
  field: keyof T & string,
  exec: (db: DB, rows: R[]) => Promise<unknown>,
): DbHandler {
  return async ({ db, body, route }) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error, route);
    const rows = parsed.data[field] as unknown as R[];
    await exec(db, rows);
    return NextResponse.json({ ok: true });
  };
}

// --- Providers ---

const providersListHandler: DbHandler = async ({ db }) =>
  NextResponse.json(await storage.getAllProviders(db));

const providersListWithModelsHandler: DbHandler = async ({ db }) =>
  NextResponse.json(await storage.getAllProvidersWithModels(db));

const providersGetHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(await storage.getProvider(db, readString(body, 'id') ?? ''));

const providersUpsertHandler: DbHandler = makeUpsertHandler(
  ProviderUpsertBody,
  (db, data) => storage.upsertProvider(db, data),
);

// SU-ITER-092-batch3 · A3-MEDIUM-02 — single-call replacement for the
// client-side N-writes pattern in `provider-store.setDefaultProvider`.
// See storage-service.setDefaultProvider for the transactional rationale.
const providersSetDefaultHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = SetDefaultProviderBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  await storage.setDefaultProvider(db, parsed.data.id);
  return NextResponse.json({ ok: true });
};

const providersDeleteHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  const guard = requireField(id, 'id');
  if (guard) return guard;
  await storage.deleteProvider(db, id);
  return NextResponse.json({ ok: true });
};

// --- Provider Models ---

const modelsListHandler: DbHandler = async ({ db, body }) => {
  const providerId = readString(body, 'providerId') ?? '';
  return NextResponse.json(await storage.getModelsForProvider(db, providerId));
};

const modelsUpsertHandler: DbHandler = makeUpsertHandler(
  ProviderModelUpsertBody,
  (db, data) => storage.upsertProviderModel(db, data),
);

const modelsDeleteHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  const guard = requireField(id, 'id');
  if (guard) return guard;
  await storage.deleteProviderModel(db, id);
  return NextResponse.json({ ok: true });
};

const modelsDeleteForProviderHandler: DbHandler = async ({ db, body }) => {
  const providerId = readString(body, 'providerId') ?? '';
  const guard = requireField(providerId, 'providerId');
  if (guard) return guard;
  await storage.deleteModelsForProvider(db, providerId);
  return NextResponse.json({ ok: true });
};

// --- Entities ---

const entitiesListHandler: DbHandler = async ({ db }) =>
  NextResponse.json(await storage.getAllEntities(db));

const entitiesGetHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(await storage.getEntity(db, readString(body, 'id') ?? ''));

const entitiesUpsertHandler: DbHandler = makeUpsertHandler(
  EntityUpsertBody,
  (db, data) => storage.upsertEntity(db, data),
);

const entitiesDeleteHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  const guard = requireField(id, 'id');
  if (guard) return guard;
  await storage.deleteEntity(db, id);
  return NextResponse.json({ ok: true });
};

// --- Chat Sessions ---

const chatSessionsListHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getSessionsForEntity(db, readString(body, 'entityId') ?? ''),
  );

const chatSessionGetHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(await storage.getSession(db, readString(body, 'id') ?? ''));

const chatSessionUpsertHandler: DbHandler = makeUpsertHandler(
  SessionUpsertBody,
  (db, data) => storage.upsertSession(db, data),
);

const chatSessionDeleteHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  const guard = requireField(id, 'id');
  if (guard) return guard;
  await storage.deleteSession(db, id);
  return NextResponse.json({ ok: true });
};

// --- Chat Messages ---

const chatMessagesHandler: DbHandler = async ({ db, body }) => {
  const sessionId = readString(body, 'sessionId') ?? '';
  // SU-ITER-091-batch2 · P3-08 — optional limit/offset for paginated
  // reads.  When omitted the helper falls back to "return everything"
  // for backwards compatibility with existing callers (chat store
  // still reads the full history on session open).
  const limitRaw = readField<unknown>(body, 'limit');
  const offsetRaw = readField<unknown>(body, 'offset');
  const limit = typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, 10_000)
    : undefined;
  const offset = typeof offsetRaw === 'number' && Number.isInteger(offsetRaw) && offsetRaw >= 0
    ? offsetRaw
    : undefined;
  return NextResponse.json(
    await storage.getMessagesForSession(db, sessionId, { limit, offset }),
  );
};

const chatMessagesByEntityHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getMessagesForEntity(db, readString(body, 'entityId') ?? ''),
  );

const chatMessageInsertHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = MessageInsertBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const result = await storage.insertMessage(db, parsed.data);
  return NextResponse.json({ ok: true, ...result });
};

const chatMessagesInsertBatchHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = MessageBatchBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const result = await storage.insertMessages(
    db,
    parsed.data.messages as unknown as Parameters<typeof storage.insertMessages>[1],
  );
  return NextResponse.json({ ok: true, ...result });
};

const chatMessageDeleteHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  const guard = requireField(id, 'id');
  if (guard) return guard;
  await storage.deleteMessage(db, id);
  return NextResponse.json({ ok: true });
};

const chatMessagesDeleteForSessionHandler: DbHandler = async ({ db, body }) => {
  const sessionId = readString(body, 'sessionId') ?? '';
  const guard = requireField(sessionId, 'sessionId');
  if (guard) return guard;
  await storage.deleteMessagesForSession(db, sessionId);
  return NextResponse.json({ ok: true });
};

// --- Profile + Drafts + Config ---

const profileGetHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  return NextResponse.json(await storage.getUserProfile(db, id || undefined));
};

const profileUpsertHandler: DbHandler = makeUpsertHandler(
  UserProfileUpsertBody,
  (db, data) => storage.upsertUserProfile(db, data),
);

const draftsGetHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(await storage.getDraft(db, readString(body, 'id') ?? ''));

const draftsUpsertHandler: DbHandler = makeUpsertHandler(
  DraftUpsertBody,
  (db, data) => storage.upsertDraft(db, data),
);

const draftsDeleteHandler: DbHandler = async ({ db, body }) => {
  const id = readString(body, 'id') ?? '';
  const guard = requireField(id, 'id');
  if (guard) return guard;
  await storage.deleteDraft(db, id);
  return NextResponse.json({ ok: true });
};

const configGetHandler: DbHandler = async ({ db, body }) => {
  const key = readString(body, 'key') ?? '';
  const guard = requireField(key, 'key');
  if (guard) return guard;
  return NextResponse.json(await storage.getConfig(db, key));
};

const configSetHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = ConfigSetBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  await storage.setConfig(db, parsed.data.key, parsed.data.value);
  return NextResponse.json({ ok: true });
};

const configDeleteHandler: DbHandler = async ({ db, body }) => {
  const key = readString(body, 'key') ?? '';
  const guard = requireField(key, 'key');
  if (guard) return guard;
  await storage.deleteConfig(db, key);
  return NextResponse.json({ ok: true });
};

// --- Memory Events / Facts / Summaries / Relationship / Open Loops ---

const sessionStateGetHandler: DbHandler = async ({ db, body }) => {
  const sessionId = readString(body, 'sessionId') ?? '';
  const guard = requireField(sessionId, 'sessionId');
  if (guard) return guard;
  return NextResponse.json(await storage.getSessionState(db, sessionId));
};

const sessionStateUpsertHandler: DbHandler = makeUpsertHandler(
  SessionStateUpsertBody,
  (db, data) => storage.upsertSessionState(db, data),
);

const memoryEventsListHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getMemoryEventsForEntity(db, readString(body, 'entityId') ?? ''),
  );

const memoryEventsInsertBatchHandler: DbHandler = makeBatchHandler(
  MemoryEventsBatchBody,
  'events',
  storage.insertMemoryEvents,
);

const memoryFactsListHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getMemoryFactsForEntity(db, readString(body, 'entityId') ?? ''),
  );

const memoryFactsInsertBatchHandler: DbHandler = makeBatchHandler(
  MemoryFactsBatchBody,
  'facts',
  storage.insertMemoryFacts,
);

const memoryFactsUpsertMergeHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = MemoryFactUpsertMergeBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const id = await storage.upsertMemoryFactByMergeKey(db, parsed.data.fact as Parameters<
    typeof storage.upsertMemoryFactByMergeKey
  >[1]);
  return NextResponse.json({ ok: true, id });
};

const memorySummariesListHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getMemorySummariesForEntity(db, readString(body, 'entityId') ?? ''),
  );

const memorySummariesInsertBatchHandler: DbHandler = makeBatchHandler(
  MemorySummariesBatchBody,
  'summaries',
  storage.insertMemorySummaries,
);

const memoryRelationshipGetHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getRelationshipSnapshotForEntity(db, readString(body, 'entityId') ?? ''),
  );

const memoryRelationshipUpsertHandler: DbHandler = makeUpsertHandler(
  RelationshipSnapshotUpsertBody,
  (db, data) => storage.upsertRelationshipSnapshot(db, data),
);

const memoryLoopsListHandler: DbHandler = async ({ db, body }) =>
  NextResponse.json(
    await storage.getOpenLoopsForEntity(db, readString(body, 'entityId') ?? ''),
  );

const memoryLoopsInsertBatchHandler: DbHandler = makeBatchHandler(
  OpenLoopsBatchBody,
  'loops',
  storage.insertOpenLoops,
);

const memoryEmbeddingUpsertHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = MemoryEmbeddingUpsertBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const d = parsed.data;
  await storage.upsertMemoryEmbedding(db, {
    memoryId: d.memoryId,
    memoryKind: d.memoryKind,
    modelName: d.modelName,
    embedding: d.embedding,
  });
  return NextResponse.json({ ok: true });
};

const memoryEmbeddingsListHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = MemoryEmbeddingsListBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  const rows = await storage.listMemoryEmbeddingsForEntity(
    db,
    parsed.data.entityId,
    parsed.data.modelName,
  );
  return NextResponse.json(rows);
};

const memoryEmbeddingsDeleteForEntityHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = MemoryEmbeddingsDeleteForEntityBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  await storage.deleteMemoryEmbeddingsForEntity(
    db,
    parsed.data.entityId,
    parsed.data.modelName ?? null,
  );
  return NextResponse.json({ ok: true });
};

const memoryRestoreEntityAtomicHandler: DbHandler = async ({ db, body, route }) => {
  const parsed = RestoreEntityBody.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error, route);
  await runAtomicEntityRestore(
    db,
    parsed.data.payload as unknown as AtomicEntityRestorePayload,
    parsed.data.strategy,
  );
  return NextResponse.json({ ok: true });
};

// ============================================================
// Dispatch tables
// ============================================================

const PUBLIC_HANDLERS: Map<string, PublicHandler> = new Map([
  ['migration/status', migrationStatusHandler],
  // SU-ITER-092-batch3 · A1-N4 — see handler defs above for rationale
  // (staying public is UX-driven, residual logged as R-093-05).
  ['migration/cleanup-v1-backup', migrationCleanupV1],
  ['migration/cleanup-rekey-backup', migrationCleanupRekey],
  ['migration/recover-from-bak', migrationRecoverFromBak],
  ['migration/recover-from-rekey-bak', migrationRecoverFromRekeyBak],
  ['migration/repair-false-marker', migrationRepairFalseMarkerHandler],
  ['migration/restore-v1-backup-over-active', migrationRestoreV1BackupOverActiveHandler],
  ['migration/v1-to-v2', migrationV1ToV2Handler],
  ['session/close', sessionCloseHandler],
  ['session/status', sessionStatusHandler],
  // SU-ITER-091-batch3 — V1 backup compatibility.  Public because
  // the user re-authenticates with the password here; no existing
  // DB session is required (a post-migration user restoring a V1
  // backup will typically have a v2 session already open but the
  // endpoint does not rely on it).
  ['backup/derive-legacy-dek', backupDeriveLegacyDekHandler],
]);

const ACCOUNTS_HANDLERS: Map<string, PublicHandler> = new Map([
  ['accounts/list', accountsListHandler],
  ['accounts/get', accountsGetHandler],
  ['accounts/put', accountsPutHandler],
  ['accounts/change-password', accountsChangePasswordHandler],
  ['accounts/delete', accountsDeleteHandler],
]);

const DB_HANDLERS: Map<string, DbHandler> = new Map([
  // providers
  ['providers/list', providersListHandler],
  ['providers/list-with-models', providersListWithModelsHandler],
  ['providers/get', providersGetHandler],
  ['providers/upsert', providersUpsertHandler],
  ['providers/set-default', providersSetDefaultHandler],
  ['providers/delete', providersDeleteHandler],
  // models
  ['models/list', modelsListHandler],
  ['models/upsert', modelsUpsertHandler],
  ['models/delete', modelsDeleteHandler],
  ['models/delete-for-provider', modelsDeleteForProviderHandler],
  // entities
  ['entities/list', entitiesListHandler],
  ['entities/get', entitiesGetHandler],
  ['entities/upsert', entitiesUpsertHandler],
  ['entities/delete', entitiesDeleteHandler],
  // chat sessions
  ['chat/sessions', chatSessionsListHandler],
  ['chat/session/get', chatSessionGetHandler],
  ['chat/session/upsert', chatSessionUpsertHandler],
  ['chat/session/delete', chatSessionDeleteHandler],
  ['chat/session-state/get', sessionStateGetHandler],
  ['chat/session-state/upsert', sessionStateUpsertHandler],
  // chat messages
  ['chat/messages', chatMessagesHandler],
  ['chat/messages/by-entity', chatMessagesByEntityHandler],
  ['chat/message/insert', chatMessageInsertHandler],
  ['chat/messages/insert-batch', chatMessagesInsertBatchHandler],
  ['chat/message/delete', chatMessageDeleteHandler],
  ['chat/messages/delete-for-session', chatMessagesDeleteForSessionHandler],
  // profile / drafts / config
  ['profile/get', profileGetHandler],
  ['profile/upsert', profileUpsertHandler],
  ['drafts/get', draftsGetHandler],
  ['drafts/upsert', draftsUpsertHandler],
  ['drafts/delete', draftsDeleteHandler],
  ['config/get', configGetHandler],
  ['config/set', configSetHandler],
  ['config/delete', configDeleteHandler],
  // memory
  ['memory/events/list', memoryEventsListHandler],
  ['memory/events/insert-batch', memoryEventsInsertBatchHandler],
  ['memory/facts/list', memoryFactsListHandler],
  ['memory/facts/insert-batch', memoryFactsInsertBatchHandler],
  ['memory/facts/upsert-merge', memoryFactsUpsertMergeHandler],
  ['memory/summaries/list', memorySummariesListHandler],
  ['memory/summaries/insert-batch', memorySummariesInsertBatchHandler],
  ['memory/relationship/get', memoryRelationshipGetHandler],
  ['memory/relationship/upsert', memoryRelationshipUpsertHandler],
  ['memory/loops/list', memoryLoopsListHandler],
  ['memory/loops/insert-batch', memoryLoopsInsertBatchHandler],
  ['memory/embeddings/upsert', memoryEmbeddingUpsertHandler],
  ['memory/embeddings/list-for-entity', memoryEmbeddingsListHandler],
  ['memory/embeddings/delete-for-entity', memoryEmbeddingsDeleteForEntityHandler],
  ['memory/restore-entity-atomic', memoryRestoreEntityAtomicHandler],
]);

// ============================================================
// POST entry point
// ============================================================

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  const { path } = await params;
  const route = path.join('/');
  const body = await parseBody(req);

  // §1 — Public migration + session routes.
  const pub = PUBLIC_HANDLERS.get(route);
  if (pub) {
    try {
      return await pub({ req, body, route });
    } catch (err) {
      return safeErrorResponse(err, route);
    }
  }

  // `session/open` is complex enough that it stays inline.
  if (route === 'session/open') {
    try {
      return await handleSessionOpen(req, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[db-api] session/open uncaught (bug path):', err);
      return NextResponse.json(
        {
          error: 'session_open_uncaught',
          ...(process.env.NODE_ENV === 'development' ? { detail: msg.slice(0, 500) } : {}),
        },
        { status: 500 },
      );
    }
  }

  // §2 — Accounts routes.
  const acct = ACCOUNTS_HANDLERS.get(route);
  if (acct) {
    try {
      return await acct({ req, body, route });
    } catch (err) {
      return safeErrorResponse(err, route);
    }
  }

  // §3 — All routes below require an active DB session.
  const handler = DB_HANDLERS.get(route);
  if (!handler) {
    // SU-ITER-089 · P1-2 cleanup (sec-N-1): don't echo the request path
    // in the error body — a stable code only so clients can't sniff
    // which routes exist.  The log line above still records the path
    // via `safeErrorResponse` / `localhostGuard` for operator use.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { db, error } = withDb(req);
  // SU-ITER-092-batch3 · A4-MEDIUM — `withDb` invariant: `error` is
  // always populated whenever `db` is null (both 401 branches above set
  // it), and is undefined when `db` is non-null.  Drop the previous
  // `error!` non-null assertion in favour of an explicit fallback so
  // `no-non-null-assertion: error` passes without relaxing the rule.
  if (!db) {
    return (
      error ??
      NextResponse.json({ error: 'No session' }, { status: 401 })
    );
  }

  try {
    return await handler({ db, body, route });
  } catch (err) {
    return safeErrorResponse(err, route);
  }
}
