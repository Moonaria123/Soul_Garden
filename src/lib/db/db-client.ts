'use client';

// ============================================================
// Database Client (browser-side)
// Wraps HTTP calls to /api/db/* API routes.
// Session token managed via httpOnly cookie automatically.
// ============================================================
//
// SU-ITER-089 · P1-2 — `any` reduction pass.
// All row shapes are sourced from the shared Drizzle schema via
// `import type`, which is erased at compile time and contributes zero
// runtime bytes to the client bundle.  Callers still adapt the raw DTOs
// to their richer domain models (e.g. `providerRowToLocal`) because
// Drizzle returns JSON-encoded text columns as-is.

import type * as schema from './schema';
import type { PublicAccount, LoginMaterial } from './accounts-schema';
import type { StoredAccount } from './accounts-file';
import { guardTestingHooks } from '@/lib/security/testing-hooks-guard';

// --- DB row DTOs (serialised JSON mirrors of Drizzle $inferSelect) ---
//
// These alias the server's Drizzle row types so the client never
// re-declares column shapes.  Using `typeof schema.*.$inferSelect`
// keeps the two sides in lock-step without a runtime schema import.

export type ProviderRow = typeof schema.providers.$inferSelect;
export type ProviderInsert = typeof schema.providers.$inferInsert;
export type ProviderModelRow = typeof schema.providerModels.$inferSelect;
export type ProviderModelInsert = typeof schema.providerModels.$inferInsert;
export type EntityRow = typeof schema.entities.$inferSelect;
export type EntityInsert = typeof schema.entities.$inferInsert;
export type ChatSessionRow = typeof schema.chatSessions.$inferSelect;
export type ChatSessionInsert = typeof schema.chatSessions.$inferInsert;
export type ChatMessageRow = typeof schema.chatMessages.$inferSelect;
export type ChatMessageInsert = typeof schema.chatMessages.$inferInsert;
export type UserProfileRow = typeof schema.userProfiles.$inferSelect;
export type UserProfileInsert = typeof schema.userProfiles.$inferInsert;
export type DraftRow = typeof schema.drafts.$inferSelect;
export type DraftInsert = typeof schema.drafts.$inferInsert;
export type AppConfigRow = typeof schema.appConfig.$inferSelect;
export type MemoryEventRow = typeof schema.memoryEvents.$inferSelect;
export type MemoryEventInsert = typeof schema.memoryEvents.$inferInsert;
export type MemoryFactRow = typeof schema.memoryFacts.$inferSelect;
export type MemoryFactInsert = typeof schema.memoryFacts.$inferInsert;
export type MemorySummaryRow = typeof schema.memorySummaries.$inferSelect;
export type MemorySummaryInsert = typeof schema.memorySummaries.$inferInsert;
export type RelationshipSnapshotRow = typeof schema.relationshipSnapshots.$inferSelect;
export type RelationshipSnapshotInsert = typeof schema.relationshipSnapshots.$inferInsert;
export type OpenLoopRow = typeof schema.openLoops.$inferSelect;
export type OpenLoopInsert = typeof schema.openLoops.$inferInsert;

// Shape the server accepts on `POST /api/db/accounts/put` — either a
// fresh registration payload or a profile update.  Mirrors
// `AccountCreateSchema` / `AccountProfileUpdateSchema` server-side.
export type AccountPutPayload =
  | {
      id: string;
      username: string;
      passwordHash: string;
      salt: string;
      email?: string;
      createdAt: string;
    }
  | {
      id: string;
      username?: string;
      email?: string;
    };

// Shape the server accepts on `POST /api/db/memory/restore-entity-atomic`.
// `object` is chosen deliberately over `Record<string, unknown>` to keep
// strongly-typed callers (`EntityBackupPayload` from `backup-format.ts`,
// a nominal interface without an index signature) flowing without
// casting, while still excluding primitives/arrays at the type boundary.
// SU-ITER-091-batch1 · sec-C-C delivered the strict `.strict()` Zod
// validator (`AtomicEntityRestorePayloadSchema` in `restore-atomic.ts`)
// at the route boundary, so the wire-level shape is now fully enforced;
// `object` here remains the client-side ergonomic alias that avoids
// forcing every caller to import `AtomicEntityRestorePayload` from the
// server module just to satisfy TypeScript.  If/when we migrate callers
// to the shared zod-inferred type directly, this alias can drop.
export type RestoreEntityPayload = object;

const BASE = '/api/db';

/**
 * Structured error thrown by the db-client when the server returns a non-2xx
 * response.  The `code` mirrors the server's `error` field (e.g. `invalid_credentials`,
 * `account_locked`, `single_user_mode`) and `data` carries the full JSON body so
 * callers can surface `failedAttempts` / `remainingMinutes` / etc. without
 * re-parsing the generic `Error.message` string (SU-088 P0-B).
 */
export class DbClientError extends Error {
  code: string;
  status: number;
  data: Record<string, unknown>;
  constructor(code: string, status: number, data: Record<string, unknown>, message?: string) {
    super(message ?? code);
    this.name = 'DbClientError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/**
 * Default abort deadline for routine DB calls (list, get, upsert, …).
 * 10 s is an order of magnitude above any healthy local libsql
 * round-trip; exceeding it means the server is stuck and the browser
 * would rather surface a visible error than block the UI indefinitely.
 */
const DEFAULT_POST_TIMEOUT_MS = 10_000;

/**
 * Extended deadline for routes that run the full-database rekey or
 * v1-to-v2 migration pipeline.  Those paths can legitimately take
 * minutes on large accounts (tens of thousands of rows × Argon2id +
 * AES-GCM column-level work).  10 min is the empirical ceiling we
 * accept — beyond that we'd rather surface a timeout and have the
 * user retry than leave the fetch pending forever.
 *
 * SU-ITER-091-batch1 · R-C3 — this replaces the hard-coded 10 s that
 * made `changePassword` / `migration/v1-to-v2` / `recover-from-*`
 * look like they had "failed" after 10 s even though the server was
 * still mid-transaction.  The client now treats those three routes
 * as long-running and extends the deadline accordingly; every other
 * route keeps the old 10 s cap.
 */
const LONG_RUNNING_POST_TIMEOUT_MS = 10 * 60 * 1_000;

export interface PostOptions {
  /**
   * Override the default abort deadline (in milliseconds).  Callers
   * should use {@link LONG_RUNNING_POST_TIMEOUT_MS} for the rekey /
   * migration pipeline and leave this unset everywhere else.
   *
   * Values `<= 0` disable the AbortController entirely — intended
   * **only** for tests that need to assert on the pending-fetch case.
   * In `NODE_ENV==='production'` a non-positive value is rejected at
   * runtime (see `post` implementation below) so that a stray hot-fix
   * that passes `0` cannot silently disable the UI dead-man switch.
   */
  timeoutMs?: number;
}

/**
 * Internal JSON POST helper.
 *
 * `T` defaults to `unknown` so callers must narrow explicitly — this
 * replaces the previous `T = any` that silently opted out of
 * typechecking (SU-ITER-089 P1-2).
 *
 * SU-ITER-091-batch1 · R-C3 — the third `options` argument lets the
 * long-running migration/rekey routes opt into a 10-minute deadline
 * without affecting the default 10 s ceiling every other call-site
 * relies on for "server stuck" detection.
 */
async function post<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
  options: PostOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_POST_TIMEOUT_MS;
  // SU-ITER-092-batch1 · Nit-1 — production guard.  `timeoutMs <= 0` is a
  // test-only escape hatch; in production it would silently disable the
  // UI-level fetch deadline and mask a hung server.  Refuse at the entry
  // point rather than deep in fetch so misuse is obvious and local.
  if (timeoutMs <= 0 && process.env.NODE_ENV === 'production') {
    throw new Error(
      `[db-client] post('${path}') called with non-positive timeoutMs=${timeoutMs}; ` +
      `this is a test-only escape hatch and is rejected in production.`,
    );
  }
  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      signal: controller.signal,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText } as Record<string, unknown>));
      const code = typeof payload.error === 'string' ? payload.error : `http_${res.status}`;
      throw new DbClientError(code, res.status, payload, code);
    }
    return res.json() as Promise<T>;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// --- Session ---

// SU-ITER-089 · P1-1 · B8-2 (v2 contract).  The browser no longer
// derives or transmits the DB DEK; the server handles that entirely.
// In exchange, the server returns the account `salt` so the caller can
// derive the Client KEK (AES-GCM key for API-key/backup payloads)
// without a second `accounts/get` round-trip.  Localhost-only, so the
// plaintext password-over-wire threat model matches SU-088 P0-B.
export async function openSession(
  userId: string,
  password: string,
): Promise<{ ok: boolean; token: string; salt: string }> {
  return post<{ ok: boolean; token: string; salt: string }>(
    'session/open',
    { userId, password },
  );
}

// --- Migration (SU-ITER-089 · P1-1 · B8-3) ---
//
// The login surface consults migration/status on boot; MigrationWizard
// posts migration/v1-to-v2 when the user accepts the upgrade.  Failure
// codes mirror `MigrationErrorCode` in `@/lib/db/migration-v2`.

export type MigrationStateDTO =
  | 'fresh'
  | 'migrated'
  | 'needs-migration'
  | 'mid-migration'
  | 'bak-only'
  | 'rekey-bak-only';

export interface MigrationStatusReport {
  state: MigrationStateDTO;
  hasV1Backup: boolean;
  hasRekeyBackup: boolean;
}

export async function getMigrationStatus(): Promise<MigrationStatusReport> {
  return post<MigrationStatusReport>('migration/status');
}

export async function runMigrationV1ToV2(
  userId: string,
  password: string,
): Promise<{ ok: true; stats: { tables: Record<string, number>; totalRows: number; durationMs: number } }> {
  // SU-ITER-091-batch1 · R-C3 — full-database v1→v2 rekey can run for
  // minutes on large accounts; use the extended deadline.
  return post<{ ok: true; stats: { tables: Record<string, number>; totalRows: number; durationMs: number } }>(
    'migration/v1-to-v2',
    { userId, password },
    { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS },
  );
}

/**
 * When `.db-v2-marker` exists but the DB file is still v1-encrypted, remove the
 * marker so `migration/v1-to-v2` can run (server verifies v2 fails + v1 opens).
 */
export async function repairFalseMigratedMarker(
  userId: string,
  password: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: string; detail?: string }
> {
  try {
    await post<{ ok: true }>(
      'migration/repair-false-marker',
      { userId, password },
      { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof DbClientError && e.data && typeof e.data === 'object') {
      const data = e.data as { error?: string; reason?: string; detail?: string };
      if (data.error === 'repair_failed' && typeof data.reason === 'string') {
        return {
          ok: false,
          reason: data.reason,
          ...(typeof data.detail === 'string' ? { detail: data.detail } : {}),
        };
      }
    }
    throw e;
  }
}

/**
 * Replace active `soul-upload.db` from `soul-upload.db.bak-v1` and remove the
 * v2 marker (password-verified server route).
 */
export async function restoreV1BackupOverActiveDb(
  userId: string,
  password: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: string; detail?: string }
> {
  try {
    await post<{ ok: true }>(
      'migration/restore-v1-backup-over-active',
      { userId, password },
      { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof DbClientError && e.data && typeof e.data === 'object') {
      const data = e.data as { error?: string; reason?: string; detail?: string };
      if (data.error === 'restore_failed' && typeof data.reason === 'string') {
        return {
          ok: false,
          reason: data.reason,
          ...(typeof data.detail === 'string' ? { detail: data.detail } : {}),
        };
      }
    }
    throw e;
  }
}

/**
 * SU-ITER-089 · P1-1 · B8-8 — remove the `.bak-v1` backup file kept
 * around after a v1→v2 migration.  Safe to call at any time; the
 * server treats a missing backup as success.
 */
export async function cleanupV1Backup(): Promise<{ ok: true }> {
  return post<{ ok: true }>('migration/cleanup-v1-backup');
}

/**
 * Remove the `.bak-rekey` backup left by the last password rotation.
 */
export async function cleanupRekeyBackup(): Promise<{ ok: true }> {
  return post<{ ok: true }>('migration/cleanup-rekey-backup');
}

/**
 * Recover from the rare `bak-only` startup state (mid-migration crash
 * between renames 2 and 3).  Only valid when `getMigrationStatus()`
 * returned `state === 'bak-only'`.
 */
export async function recoverFromBakOnly(): Promise<{ ok: true }> {
  // SU-ITER-091-batch1 · R-C3 — recovery path replays the mid-
  // migration rename sequence; on a populated account this may
  // exceed the default 10 s ceiling.
  return post<{ ok: true }>(
    'migration/recover-from-bak',
    {},
    { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS },
  );
}

/**
 * Recover from the rare `rekey-bak-only` startup state (change-password
 * double-failure window: db swap committed, accounts.json write failed,
 * rollback unlink succeeded but the bak-rekey → db rename did not).
 * Only valid when `getMigrationStatus()` returned
 * `state === 'rekey-bak-only'`.  Restores the pre-rekey backup — the
 * user logs in with the OLD password afterwards.
 *
 * Added 2026-04-19 (B8 Stage B Gate · code-C-2 / sec-C-2).
 */
export async function recoverFromRekeyBak(): Promise<{ ok: true }> {
  // SU-ITER-091-batch1 · R-C3 — rekey rollback touches every row just
  // like the forward migration; grant it the extended deadline.
  return post<{ ok: true }>(
    'migration/recover-from-rekey-bak',
    {},
    { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS },
  );
}

export async function closeSession(): Promise<void> {
  await post('session/close');
}

export async function getSessionStatus(): Promise<{ active: boolean }> {
  return post<{ active: boolean }>('session/status');
}

// --- Backup / V1 compatibility (SU-ITER-091-batch3) ---

/**
 * Re-derive the legacy (v1 KDF) payload DEK for a single V1 backup
 * import on a post-migration install.  Server rate-limits at
 * 5/min per (ip, userId) and runs through the shared account
 * lockout ladder, so a wrong password progresses the ladder just
 * like `session/open`.
 *
 * The returned `dekHex` is sensitive — callers MUST use it in a
 * single `decryptPayloadWithDekHex` call and drop the reference
 * immediately.  Do NOT persist it anywhere (session storage, state,
 * or closure outside the restore dialog's async lifetime).
 */
export async function deriveLegacyBackupDek(
  userId: string,
  password: string,
): Promise<{ ok: true; dekHex: string; saltHex: string }> {
  return post<{ ok: true; dekHex: string; saltHex: string }>(
    'backup/derive-legacy-dek',
    { userId, password },
  );
}

// --- Accounts (no DB session needed) ---
//
// `listAccounts` and `getAccount({ id })` return PublicAccount.
// `getAccount({ username })` returns LoginMaterial (salt + lockUntil).
// Callers still downcast to UserAccount where the richer shape is
// needed; the union return type communicates which fields are actually
// present after server-side sanitisation (SU-088 · P0-D).

export async function listAccounts(): Promise<PublicAccount[]> {
  return post<PublicAccount[]>('accounts/list');
}

export async function getAccount(
  query: { id?: string; username?: string },
): Promise<PublicAccount | LoginMaterial | null> {
  return post<PublicAccount | LoginMaterial | null>('accounts/get', query);
}

export async function putAccount(account: AccountPutPayload): Promise<void> {
  // `AccountPutPayload` is a Zod-discriminated union ('create' | 'update'),
  // so TS cannot widen it to `Record<string, unknown>` directly.  The
  // server re-validates the body with the same schema in
  // `/api/db/accounts/put`, so the double assertion is safe at the wire
  // boundary.
  await post('accounts/put', account as unknown as Record<string, unknown>);
}

export async function deleteAccount(id: string): Promise<void> {
  await post('accounts/delete', { id });
}

/**
 * Change the account's password.
 *
 * SU-088 · P0-D kept rotation on its own route so the generic
 * `accounts/put` path can never be used to silently change a password.
 *
 * SU-ITER-089 · P1-1 · B8-5: the client now submits plaintext old and
 * new passwords; the server verifies + strength-gates + Argon2id-hashes
 * + re-keys the entire database in one atomic operation.  The response
 * includes migration-style stats so the UI can show a spinner with
 * row counts during the rekey.  All live DB sessions are evicted
 * server-side — callers MUST route the user to re-login on success.
 */
export async function changePassword(payload: {
  id: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{
  ok: true;
  stats: {
    tables: Record<string, number>;
    totalRows: number;
    durationMs: number;
  };
}> {
  // SU-ITER-091-batch1 · R-C3 — change-password re-encrypts every
  // row in every table (Argon2id derive + AES-GCM stream); the
  // default 10 s ceiling falsely flags the mid-transaction state as
  // a failure on non-trivial accounts.  Extend to the 10-minute cap.
  const res = await post<{
    ok: true;
    stats: {
      tables: Record<string, number>;
      totalRows: number;
      durationMs: number;
    };
  }>(
    'accounts/change-password',
    payload,
    { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS },
  );
  return res;
}

/**
 * @deprecated SU-ITER-089 · P1-1 · B8-6.
 *
 * The standalone re-unlock endpoint was removed because `session/open`
 * already performs an identical password verify + lockout progression
 * and returns the salt inside its v2 contract (B8-2).  Keeping two
 * near-identical verify paths was a STRIDE Repudiation/Tampering
 * hazard — auditing had to reason about both logs, and the lockout
 * state could diverge if one path was bypassed.
 *
 * Callers (`reunlock-dialog`) now go through {@link openSession}
 * directly.  This stub remains only so external code that imports the
 * symbol gets a deprecation warning at compile time; it will be
 * removed in SU-ITER-090.
 */
export async function reunlockAccount(
  id: string,
  password: string,
): Promise<{ ok: true; salt: string }> {
  const { salt } = await openSession(id, password);
  return { ok: true, salt };
}

/**
 * Raw-account getter for internal flows that still need the stored
 * record (lockout progression, etc.).  Exposes `StoredAccount` to keep
 * the callers honest about the sensitivity of the result.
 */
export type RawAccount = StoredAccount;

// --- Providers ---

export async function listProviders(): Promise<ProviderRow[]> {
  return post<ProviderRow[]>('providers/list');
}

/**
 * SU-ITER-090c · P2-07 — batch loader that returns every provider with
 * its associated model rows in a single HTTP round trip.  The server side
 * executes two bulk SELECTs in parallel and groups the results, so the
 * total cost is O(2) regardless of provider count.  Prefer this over
 * `listProviders` + per-provider `listModels` in hot paths
 * (store hydration, settings page).
 */
export async function listProvidersWithModels(): Promise<
  Array<{ provider: ProviderRow; models: ProviderModelRow[] }>
> {
  return post<Array<{ provider: ProviderRow; models: ProviderModelRow[] }>>(
    'providers/list-with-models',
  );
}

export async function getProvider(id: string): Promise<ProviderRow | null> {
  return post<ProviderRow | null>('providers/get', { id });
}

export async function upsertProvider(data: ProviderInsert): Promise<void> {
  await post('providers/upsert', data as unknown as Record<string, unknown>);
}

// SU-ITER-092-batch3 · A3-MEDIUM-02 — single HTTP flip of the "default
// provider" bit.  Replaces the previous per-row `upsertProvider` fanout
// in `provider-store.setDefaultProvider`; the server performs a single
// `UPDATE providers SET is_default = CASE …` (see
// `storage-service.setDefaultProvider`).
export async function setDefaultProvider(id: string): Promise<void> {
  await post('providers/set-default', { id });
}

export async function deleteProvider(id: string): Promise<void> {
  await post('providers/delete', { id });
}

// --- Provider Models ---

export async function listModels(providerId: string): Promise<ProviderModelRow[]> {
  return post<ProviderModelRow[]>('models/list', { providerId });
}

export async function upsertModel(data: ProviderModelInsert): Promise<void> {
  await post('models/upsert', data as unknown as Record<string, unknown>);
}

export async function deleteModel(id: string): Promise<void> {
  await post('models/delete', { id });
}

export async function deleteModelsForProvider(providerId: string): Promise<void> {
  await post('models/delete-for-provider', { providerId });
}

// --- Entities ---

export async function listEntities(): Promise<EntityRow[]> {
  return post<EntityRow[]>('entities/list');
}

export async function getEntity(id: string): Promise<EntityRow | null> {
  return post<EntityRow | null>('entities/get', { id });
}

export async function upsertEntity(data: EntityInsert): Promise<void> {
  await post('entities/upsert', data as unknown as Record<string, unknown>);
}

export async function deleteEntity(id: string): Promise<void> {
  await post('entities/delete', { id });
}

// --- Chat Sessions ---

export async function listSessions(entityId: string): Promise<ChatSessionRow[]> {
  return post<ChatSessionRow[]>('chat/sessions', { entityId });
}

export async function getSession(id: string): Promise<ChatSessionRow | null> {
  return post<ChatSessionRow | null>('chat/session/get', { id });
}

export async function upsertSession(data: ChatSessionInsert): Promise<void> {
  await post('chat/session/upsert', data as unknown as Record<string, unknown>);
}

export async function deleteSession(id: string): Promise<void> {
  await post('chat/session/delete', { id });
}

// --- Chat Messages ---

export async function listMessages(sessionId: string): Promise<ChatMessageRow[]> {
  return post<ChatMessageRow[]>('chat/messages', { sessionId });
}

export async function listMessagesByEntity(entityId: string): Promise<ChatMessageRow[]> {
  return post<ChatMessageRow[]>('chat/messages/by-entity', { entityId });
}

export async function insertMessage(data: ChatMessageInsert): Promise<void> {
  await post('chat/message/insert', data as unknown as Record<string, unknown>);
}

export async function insertMessages(messages: ChatMessageInsert[]): Promise<void> {
  await post('chat/messages/insert-batch', { messages: messages as unknown as Record<string, unknown>[] });
}

export async function deleteMessage(id: string): Promise<void> {
  await post('chat/message/delete', { id });
}

export async function deleteMessagesForSession(sessionId: string): Promise<void> {
  await post('chat/messages/delete-for-session', { sessionId });
}

// --- User Profile ---

export async function getUserProfile(id?: string): Promise<UserProfileRow | null> {
  return post<UserProfileRow | null>('profile/get', { id });
}

export async function upsertUserProfile(data: UserProfileInsert): Promise<void> {
  await post('profile/upsert', data as unknown as Record<string, unknown>);
}

// --- Drafts ---

export async function getDraft(id: string): Promise<DraftRow | null> {
  return post<DraftRow | null>('drafts/get', { id });
}

export async function upsertDraft(data: DraftInsert): Promise<void> {
  await post('drafts/upsert', data as unknown as Record<string, unknown>);
}

export async function deleteDraft(id: string): Promise<void> {
  await post('drafts/delete', { id });
}

// --- App Config ---

export async function getConfig(key: string): Promise<AppConfigRow | null> {
  return post<AppConfigRow | null>('config/get', { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  await post('config/set', { key, value });
}

export async function deleteConfig(key: string): Promise<void> {
  await post('config/delete', { key });
}

// --- Memory Events (backup/restore) ---

export async function listMemoryEvents(entityId: string): Promise<MemoryEventRow[]> {
  return post<MemoryEventRow[]>('memory/events/list', { entityId });
}

export async function insertMemoryEvents(data: MemoryEventInsert[]): Promise<void> {
  await post('memory/events/insert-batch', {
    events: data as unknown as Record<string, unknown>[],
  });
}

// --- Memory Facts (backup/restore) ---

export async function listMemoryFacts(entityId: string): Promise<MemoryFactRow[]> {
  return post<MemoryFactRow[]>('memory/facts/list', { entityId });
}

export async function insertMemoryFacts(data: MemoryFactInsert[]): Promise<void> {
  await post('memory/facts/insert-batch', {
    facts: data as unknown as Record<string, unknown>[],
  });
}

// --- Memory Summaries (backup/restore) ---

export async function listMemorySummaries(entityId: string): Promise<MemorySummaryRow[]> {
  return post<MemorySummaryRow[]>('memory/summaries/list', { entityId });
}

export async function insertMemorySummaries(data: MemorySummaryInsert[]): Promise<void> {
  await post('memory/summaries/insert-batch', {
    summaries: data as unknown as Record<string, unknown>[],
  });
}

// --- Relationship Snapshots (backup/restore) ---

export async function getRelationshipSnapshot(
  entityId: string,
): Promise<RelationshipSnapshotRow | null> {
  return post<RelationshipSnapshotRow | null>('memory/relationship/get', { entityId });
}

export async function upsertRelationshipSnapshot(
  data: RelationshipSnapshotInsert,
): Promise<void> {
  await post('memory/relationship/upsert', data as unknown as Record<string, unknown>);
}

// --- Atomic entity restore (SU-088 P0-E) ---

/**
 * Restore a full entity (entity row + chat + memory) in a single
 * server-side transaction.  On failure the server rolls back and the
 * DB remains in its pre-restore state — callers no longer have to
 * juggle manual cleanup when an insert mid-way errors out.
 */
export async function restoreEntityAtomic(
  payload: RestoreEntityPayload,
  strategy: 'create-new' | 'replace-existing',
): Promise<void> {
  // SU-ITER-091-batch1 mini-Gate · Concern-1 cleanup — the server-side
  // transaction inserts up to the schema caps (1M messages / 1M events
  // per single-entity restore per `AtomicEntityRestorePayloadSchema`).
  // Leaving this on the default 10 s deadline let a legitimate large
  // account trip an `AbortError` while the transaction was still
  // running server-side; a user-initiated retry in `replace-existing`
  // mode could then race a committed delete against a re-running
  // delete+insert and end up with a partially-emptied table.  The
  // 10-minute cap matches the other three full-table rewrite routes
  // (migration/v1-to-v2, recover-from-rekey-bak, change-password) and
  // closes that self-Tampering window.
  await post('memory/restore-entity-atomic', {
    payload: payload as Record<string, unknown>,
    strategy,
  }, { timeoutMs: LONG_RUNNING_POST_TIMEOUT_MS });
}

// --- Open Loops (backup/restore) ---

export async function listOpenLoops(entityId: string): Promise<OpenLoopRow[]> {
  return post<OpenLoopRow[]>('memory/loops/list', { entityId });
}

export async function insertOpenLoops(data: OpenLoopInsert[]): Promise<void> {
  await post('memory/loops/insert-batch', {
    loops: data as unknown as Record<string, unknown>[],
  });
}

// SU-ITER-092-batch1 · Nit-1 — expose `post` under the standard
// `__forTesting` namespace so the production guard on `timeoutMs <= 0`
// (see implementation above) can be pinned by a unit test without
// widening the public API.  Production access is blocked by
// `guardTestingHooks`; vitest (NODE_ENV='test') sees it normally.
export const __forTesting = guardTestingHooks('db/db-client', {
  post,
});
