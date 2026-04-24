'use client';

import { v4 as uuidv4 } from 'uuid';
import * as dbClient from '@/lib/db/db-client';
import {
  readBackupZip,
  BackupVersionError,
  type BackupManifest,
  type ChatBackupPayload,
  type EntityBackupPayload,
  type ConfigBackupPayload,
  type GlobalBackupPayload,
} from './backup-format';
import { decryptPayload, decryptPayloadWithDekHex } from './backup-crypto';
import type { BackupProgressCallback } from './backup-progress';
import { noopProgress } from './backup-progress';

// ============================================================
// SU-ITER-091-batch3 — V1 backup compatibility.
//
// Callers (restore dialogs / settings card) pass a `legacyPassword
// Provider` into `parseBackupPayload` when the manifest's
// `derivation.kdfVersion === 'v1'`.  The provider prompts the user
// for their account password, which is POSTed to
// `/api/db/backup/derive-legacy-dek`.  The server re-derives a
// one-shot v1 DEK (PBKDF2 with the buggy domain suffix), returns
// the hex, and we hand it to `decryptPayloadWithDekHex` for a
// single decrypt.  The hex never leaves this function.
//
// If the provider returns `null` (user cancels) we throw a typed
// `V1BackupPasswordRequiredError` so the UI can surface a clean
// "cancelled" state rather than a generic decrypt failure.
// ============================================================

export class V1BackupPasswordRequiredError extends Error {
  constructor(message = 'legacy V1 backup requires account password to decrypt') {
    super(message);
    this.name = 'V1BackupPasswordRequiredError';
  }
}

export class V1BackupDeriveFailedError extends Error {
  /** Error code from the DbClientError — e.g. `invalid_credentials`, `rate_limited`, `account_locked`. */
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? `legacy V1 DEK derivation failed (${code})`);
    this.name = 'V1BackupDeriveFailedError';
    this.code = code;
  }
}

export interface LegacyPasswordProviderInput {
  manifest: BackupManifest;
}

/**
 * Callback the UI supplies so `parseBackupPayload` can prompt the
 * user for their password when the manifest says the payload was
 * encrypted with the legacy (v1) KDF.  Return `{ userId, password }`
 * or `null` if the user cancelled the prompt.
 */
export type LegacyPasswordProvider = (
  input: LegacyPasswordProviderInput,
) => Promise<{ userId: string; password: string } | null>;

// ============================================================
// Backup Restore — validates and writes backup data to DB
// ============================================================

export type RestoreStrategy = 'overwrite' | 'merge';
export type EntityRestoreStrategy = 'create-new' | 'replace-existing';

export interface ValidateResult {
  manifest: BackupManifest;
  valid: boolean;
  error?: string;
  /**
   * Structured failure reason surfaced from `BackupVersionError`.
   * Present only when `valid === false` and the failure was a
   * version-compat issue (SU-ITER-090b · P2-10).  UIs can route on
   * this to display an i18n'd "please upgrade the app" message
   * rather than displaying the raw `Error.message`.
   */
  errorCode?: 'future_version_not_supported'
    | 'legacy_version_not_supported'
    | 'invalid_version';
}

export async function validateBackup(file: File): Promise<ValidateResult> {
  try {
    const { manifest } = await readBackupZip(file);
    return { manifest, valid: true };
  } catch (err) {
    if (err instanceof BackupVersionError) {
      return {
        manifest: {} as BackupManifest,
        valid: false,
        error: err.message,
        errorCode: err.code,
      };
    }
    return {
      manifest: {} as BackupManifest,
      valid: false,
      error: err instanceof Error ? err.message : 'Unknown validation error',
    };
  }
}

/**
 * Union of every backup payload shape the writer produces today.
 * SU-ITER-091-batch1 · code-N-5 — callers discriminate against
 * `manifest.type` / `manifest.scope` before handing the payload to
 * the typed `restore*Payload` functions.  Using a union (rather
 * than `unknown` or `any`) keeps the contract visible at the call
 * site *and* lets `tsc --strict` catch shape drifts if any of the
 * `Backup*Payload` interfaces change in `backup-format.ts`.
 */
export type AnyBackupPayload =
  | ChatBackupPayload
  | EntityBackupPayload
  | ConfigBackupPayload
  | GlobalBackupPayload;

export interface ParseBackupOptions {
  /**
   * Called when the manifest says the payload was encrypted with
   * the legacy v1 KDF (`derivation.kdfVersion === 'v1'`).  The
   * provider is expected to collect the user's account password
   * through a modal prompt and return `{ userId, password }`, or
   * `null` to cancel the import.  Omitting this option on a v1
   * backup throws `V1BackupPasswordRequiredError` so the UI can
   * choose its own wording rather than surfacing a raw decrypt
   * failure.
   */
  legacyPasswordProvider?: LegacyPasswordProvider;
}

export async function parseBackupPayload(
  file: File,
  options: ParseBackupOptions = {},
): Promise<{ manifest: BackupManifest; payload: AnyBackupPayload }> {
  const { manifest, payloadRaw } = await readBackupZip(file);

  let json: string;
  if (!manifest.encrypted) {
    json = payloadRaw;
  } else if (manifest.derivation?.kdfVersion === 'v1') {
    // V1 path (SU-ITER-091-batch3 · B8 deviation #1).
    // The payload was encrypted with the buggy legacy PBKDF2 KDF
    // and the caller's current session DEK (v2) cannot possibly
    // decrypt it.  Prompt the user for their password and ask
    // the server to re-derive a one-shot v1 DEK.
    if (!options.legacyPasswordProvider) {
      throw new V1BackupPasswordRequiredError(
        'this backup was encrypted with the legacy v1 KDF; pass a legacyPasswordProvider to decrypt it',
      );
    }
    const creds = await options.legacyPasswordProvider({ manifest });
    if (!creds) {
      throw new V1BackupPasswordRequiredError(
        'legacy V1 backup decrypt cancelled by user',
      );
    }
    let dekHex: string;
    try {
      const res = await dbClient.deriveLegacyBackupDek(creds.userId, creds.password);
      dekHex = res.dekHex;
    } catch (err) {
      if (err instanceof dbClient.DbClientError) {
        throw new V1BackupDeriveFailedError(err.code, err.message);
      }
      throw err;
    }
    try {
      json = await decryptPayloadWithDekHex(payloadRaw, dekHex);
    } finally {
      // Hex strings are immutable in JS; zeroising the underlying
      // buffer is not possible.  Dropping the only reference is the
      // best we can do — the GC will reclaim it.  The server side
      // is authoritative for preventing DEK persistence (no logging,
      // no cache).
      dekHex = '';
    }
  } else {
    // v2 path (current).  Session DEK is authoritative.
    json = await decryptPayload(payloadRaw);
  }

  // SU-ITER-092-batch1 · Nit-4 — shallow client-side shape guard.
  //
  // Server side has full Zod coverage (`AtomicEntityRestorePayloadSchema`
  // for entity restore + `memory/*/insert-batch` row-level validators +
  // config upserts via `/config/set` type-routed) so this guard is
  // deliberately lightweight: it only asserts the *top-level keys* the
  // scope contract promises, which is enough to refuse a payload that
  // lost its envelope structure (e.g. a chat zip mis-tagged as entity,
  // or a truncated JSON that parsed to a scalar).  Deep validation
  // stays on the server so that a buggy client can't bypass it.
  const parsed: unknown = JSON.parse(json);
  assertBackupPayloadShape(parsed, manifest.scope);
  return { manifest, payload: parsed };
}

/**
 * Assert the minimal top-level shape of a decrypted backup payload
 * against its manifest scope.  On mismatch, throws a classed error
 * the UI can surface as "backup file corrupted or wrong type".
 *
 * This is the **client** guard — see `parseBackupPayload`'s JSDoc
 * above for the division of labour with the server-side Zod layer.
 */
function assertBackupPayloadShape(
  value: unknown,
  scope: BackupManifest['scope'],
): asserts value is AnyBackupPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackupPayloadShapeError(
      `Decrypted payload is not an object (type=${typeof value}).`,
    );
  }
  const obj = value as Record<string, unknown>;
  const requireObject = (key: string) => {
    const v = obj[key];
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw new BackupPayloadShapeError(
        `Payload for scope='${scope}' missing object field '${key}'.`,
      );
    }
  };
  const requireArray = (key: string) => {
    if (!Array.isArray(obj[key])) {
      throw new BackupPayloadShapeError(
        `Payload for scope='${scope}' missing array field '${key}'.`,
      );
    }
  };
  switch (scope) {
    case 'chat-only': {
      requireArray('sessions');
      requireArray('messages');
      return;
    }
    case 'entity-full': {
      requireObject('entity');
      requireObject('chat');
      requireObject('memory');
      return;
    }
    case 'config-only': {
      requireArray('providers');
      requireArray('providerModels');
      requireArray('appConfig');
      // `userProfile` is nullable — presence check only.
      if (!('userProfile' in obj)) {
        throw new BackupPayloadShapeError(
          `Payload for scope='config-only' missing key 'userProfile'.`,
        );
      }
      return;
    }
    case 'all-entities':
    case 'full': {
      // `GlobalBackupPayload` requires at least one of `entities` /
      // `config`.  Both are optional individually; the union check is
      // enough to reject a completely empty `{}` parse.
      if (!('entities' in obj) && !('config' in obj)) {
        throw new BackupPayloadShapeError(
          `Payload for scope='${scope}' has neither 'entities' nor 'config'.`,
        );
      }
      return;
    }
    default: {
      // Type-level exhaustiveness.  New scopes must extend this switch.
      const _never: never = scope;
      throw new BackupPayloadShapeError(
        `Unknown backup scope '${String(_never)}' — client guard needs update.`,
      );
    }
  }
}

/**
 * Thrown when the decrypted payload's top-level shape doesn't match
 * the manifest scope.  Distinct class so the UI can distinguish
 * "file corrupted" from crypto / zip / validation failures.
 */
export class BackupPayloadShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupPayloadShapeError';
  }
}

// --- Chat Restore (081) ---

export async function restoreChatPayload(
  entityId: string,
  payload: ChatBackupPayload,
  strategy: RestoreStrategy,
): Promise<void> {
  if (strategy === 'overwrite') {
    const existingSessions = await dbClient.listSessions(entityId);
    for (const session of existingSessions) {
      await dbClient.deleteMessagesForSession(session.id);
      await dbClient.deleteSession(session.id);
    }
  }

  for (const session of payload.sessions) {
    const sessionData = { ...session };
    if (strategy === 'overwrite') {
      sessionData.entityId = entityId;
    }
    await dbClient.upsertSession(sessionData);
  }

  if (payload.messages.length > 0) {
    const BATCH_SIZE = 200;
    for (let i = 0; i < payload.messages.length; i += BATCH_SIZE) {
      const batch = payload.messages.slice(i, i + BATCH_SIZE);
      await dbClient.insertMessages(batch);
    }
  }
}

// --- Entity Restore (082) ---

// SU-ITER-091-batch1 · code-N-5 — all `.map` callbacks below used
// `(x: any) => ...` to side-step the `any[]` on the old
// `EntityBackupPayload` interface.  Now that `backup-format.ts`
// sources row shapes from Drizzle's `$inferSelect`, TypeScript infers
// each element type automatically.  The remaining `void`-lint suppressant
// is only needed for `oldEntityId`, which we keep as a traceability
// crumb in logs even though the current flow doesn't read it.
function remapEntityIds(
  payload: EntityBackupPayload,
  newEntityId: string,
): EntityBackupPayload {
  void payload.entity.id;
  const sessionIdMap = new Map<string, string>();

  const remappedEntity = { ...payload.entity, id: newEntityId };

  const remappedSessions = payload.chat.sessions.map((s) => {
    const newSessionId = uuidv4();
    sessionIdMap.set(s.id, newSessionId);
    return { ...s, id: newSessionId, entityId: newEntityId };
  });

  const remappedMessages = payload.chat.messages.map((m) => ({
    ...m,
    id: uuidv4(),
    sessionId: sessionIdMap.get(m.sessionId) ?? m.sessionId,
    entityId: newEntityId,
  }));

  const remappedEvents = payload.memory.events.map((e) => ({
    ...e,
    id: uuidv4(),
    entityId: newEntityId,
    sessionId: e.sessionId ? (sessionIdMap.get(e.sessionId) ?? e.sessionId) : null,
  }));

  // SU-ITER-092-batch3 · A4-MEDIUM — drop the `remappedEvents[i]!.id`
  // non-null assertion.  `remappedEvents` is produced from
  // `payload.memory.events.map(...)` immediately above, so the two
  // arrays are length-matched by construction; a defensive
  // `continue` on an impossible undefined index keeps us type-safe
  // without an assertion.
  const eventIdMap = new Map<string, string>();
  payload.memory.events.forEach((orig, i) => {
    const remapped = remappedEvents[i];
    if (!remapped) return;
    eventIdMap.set(orig.id, remapped.id);
  });

  const remappedFacts = payload.memory.facts.map((f) => ({
    ...f,
    id: uuidv4(),
    entityId: newEntityId,
  }));

  const remappedSummaries = payload.memory.summaries.map((s) => ({
    ...s,
    id: uuidv4(),
    entityId: newEntityId,
  }));

  const remappedSnapshots = payload.memory.relationshipSnapshots.map((r) => ({
    ...r,
    id: uuidv4(),
    entityId: newEntityId,
  }));

  const remappedLoops = payload.memory.openLoops.map((l) => ({
    ...l,
    id: uuidv4(),
    entityId: newEntityId,
    originEventId: l.originEventId ? (eventIdMap.get(l.originEventId) ?? l.originEventId) : null,
  }));

  return {
    entity: remappedEntity,
    chat: { sessions: remappedSessions, messages: remappedMessages },
    memory: {
      events: remappedEvents,
      facts: remappedFacts,
      summaries: remappedSummaries,
      relationshipSnapshots: remappedSnapshots,
      openLoops: remappedLoops,
    },
  };
}

export async function restoreEntityPayload(
  payload: EntityBackupPayload,
  strategy: EntityRestoreStrategy,
): Promise<string> {
  let data = payload;
  let entityId = payload.entity.id;

  if (strategy === 'create-new') {
    entityId = uuidv4();
    data = remapEntityIds(payload, entityId);
  }

  // SU-088 · P0-E: delegate to the atomic server endpoint so the
  // delete + multi-table insert pipeline either applies in full or
  // rolls back.  The previous per-call sequence could leave the DB
  // with a deleted entity and partially inserted children on failure.
  await dbClient.restoreEntityAtomic(data, strategy);

  return entityId;
}

// --- Config Restore (083) ---

export async function restoreConfigPayload(
  payload: ConfigBackupPayload,
): Promise<void> {
  for (const provider of payload.providers) {
    await dbClient.upsertProvider(provider);
  }

  for (const model of payload.providerModels) {
    await dbClient.upsertModel(model);
  }

  if (payload.userProfile) {
    await dbClient.upsertUserProfile(payload.userProfile);
  }

  for (const cfg of payload.appConfig) {
    if (cfg.key && cfg.value !== undefined) {
      await dbClient.setConfig(cfg.key, cfg.value);
    }
  }
}

// --- Full / Global Restore (083) ---

export async function restoreFullPayload(
  payload: GlobalBackupPayload,
  entityStrategy: EntityRestoreStrategy = 'replace-existing',
  onProgress: BackupProgressCallback = noopProgress(),
): Promise<void> {
  if (payload.config) {
    onProgress('restoring-config', 0, 1);
    await restoreConfigPayload(payload.config);
    onProgress('restoring-config', 1, 1);
  }

  if (payload.entities) {
    for (let i = 0; i < payload.entities.length; i++) {
      onProgress('restoring-entities', i, payload.entities.length);
      await restoreEntityPayload(payload.entities[i], entityStrategy);
    }
    onProgress('restoring-entities', payload.entities.length, payload.entities.length);
  }
}
