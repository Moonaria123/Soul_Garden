'use client';

import JSZip from 'jszip';
// SU-ITER-091-batch1 · code-N-5 — source backup payload row shapes
// from Drizzle's `$inferSelect` so `any[]` drops out of this module
// and every downstream (`backup-restore.ts` / `backup-serializer.ts`
// / callers) inherits the proper row types.  Using `$inferSelect`
// (rather than `$inferInsert`) because these payloads are populated
// by SELECTs on the serialize side; round-tripping through JSON keeps
// the same shape on the restore side (Drizzle's insert accepts
// select-shaped rows because select columns are a superset of the
// minimum required for insert).
import type * as schema from '@/lib/db/schema';

// ============================================================
// Backup Container Format
// Versioned ZIP-based container (.soul-backup) shared by
// 081 (chat), 082 (entity), and 083 (global) backup flows.
//
// SU-ITER-090b · P2-10 — versioning & forward-migration pipeline.
// Previously `readBackupZip` rejected any manifest whose `version`
// was not equal to `BACKUP_FORMAT_VERSION` with a single opaque
// `Unsupported backup version` error.  That refused both:
//   (1) older files produced by earlier installs that are still
//       structurally compatible with minor default-fill-ins, and
//   (2) newer files from a future install that this client couldn't
//       possibly understand — but without telling the user why.
// We now route every manifest through a `MIGRATIONS[]` table so the
// "forward" direction (older → current) upgrades via pure adapters,
// and the "backward" direction (newer → older) fails loudly with a
// dedicated `future_version_not_supported` error code suitable for
// the UI to surface an "update the app" message.
// ============================================================

/**
 * Current manifest schema this build writes and understands.
 *
 * SU-ITER-091-batch3 · V1 backup compatibility — bumped from `1` to
 * `2`.  v2 manifests carry an explicit `derivation` field pinning
 * the KDF variant used to derive the DEK that encrypted `payload.json`
 * (`v1` = legacy buggy domain suffix, `v2` = post-migration
 * domain-separated PBKDF2).  The restore flow routes on
 * `derivation.kdfVersion` — `v2` uses the current session DEK, `v1`
 * prompts the user for their password and calls a server-side
 * one-shot legacy DEK derivation so pre-migration backups remain
 * readable from a post-migration install.
 *
 * A v1 manifest (written by SU-ITER-090 era builds) has no
 * `derivation` field at all; the migration pipeline tags it with
 * `kdfVersion: 'v1'` + `saltHex` unknown, and the decrypt path then
 * falls back to the account's current salt (which is invariant
 * across v1→v2 because migration-v2 keeps the same account record).
 */
export const BACKUP_FORMAT_VERSION = 2;

/**
 * Oldest manifest version this client still knows how to up-migrate.
 * Backups older than this are rejected with `legacy_version_not_supported`
 * rather than silently mis-interpreted.
 */
export const MIN_SUPPORTED_BACKUP_VERSION = 1;

/**
 * KDF variant marker embedded in the manifest at write time.
 * - `v2` — current domain-separated PBKDF2 (`soul-upload/v2/db-enc`).
 * - `v1` — buggy pre-migration derivation (reproduced by
 *   `deriveDbEncryptionKeyHex_v1_legacy`).  Only appears on
 *   migrated manifests, never on fresh writes.
 */
export type BackupKdfVersion = 'v1' | 'v2';

/**
 * Derivation metadata for a backup's payload DEK.  Added in
 * `BACKUP_FORMAT_VERSION = 2`.
 *
 * `saltHex` is the hex-encoded salt that was used to derive the DEK
 * (i.e. the account salt at the time of backup).  It is NOT a secret
 * — anyone with the zip already holds it — and serves purely as a
 * forensic breadcrumb.  Migrated v1 manifests leave it absent; the
 * restore flow falls back to the current account's salt, which is
 * invariant through v1→v2 migration (see `migration-v2/v1-to-v2.ts`).
 */
export interface BackupDerivationMeta {
  kdfVersion: BackupKdfVersion;
  saltHex?: string;
}

export const BACKUP_FILE_EXTENSION = '.soul-backup';

export type BackupType = 'chat' | 'entity' | 'global';
export type BackupScope =
  | 'chat-only'
  | 'entity-full'
  | 'all-entities'
  | 'config-only'
  | 'full';

export interface BackupManifest {
  version: number;
  type: BackupType;
  scope: BackupScope;
  appVersion: string;
  createdAt: string;
  entityId?: string;
  entityName?: string;
  checksum: string;
  encrypted: boolean;
  stats?: BackupStats;
  /**
   * SU-ITER-091-batch3 — KDF-variant marker.  Absent on v1
   * manifests; populated by `createBackupZip` on v2 writes and by
   * the v1→v2 manifest migration step for files imported from the
   * v1 era.  `readBackupZip` guarantees this field is present after
   * migration for any `encrypted: true` backup.
   */
  derivation?: BackupDerivationMeta;
}

export interface BackupStats {
  entityCount?: number;
  sessionCount?: number;
  messageCount?: number;
  providerCount?: number;
}

// SU-ITER-091-batch1 · code-N-5 — aliases into the Drizzle schema so
// a new column in `schema.ts` flows through to the backup payload
// shapes automatically and neither side drifts from the DB source of
// truth.  `$inferSelect` is the shape serializers emit and restorers
// consume, so everyone round-trips the same row object through JSON.
type ChatSessionRow = typeof schema.chatSessions.$inferSelect;
type ChatMessageRow = typeof schema.chatMessages.$inferSelect;
type EntityRow = typeof schema.entities.$inferSelect;
type MemoryEventRow = typeof schema.memoryEvents.$inferSelect;
type MemoryFactRow = typeof schema.memoryFacts.$inferSelect;
type MemorySummaryRow = typeof schema.memorySummaries.$inferSelect;
type RelationshipSnapshotRow = typeof schema.relationshipSnapshots.$inferSelect;
type OpenLoopRow = typeof schema.openLoops.$inferSelect;
type ProviderRow = typeof schema.providers.$inferSelect;
type ProviderModelRow = typeof schema.providerModels.$inferSelect;
type UserProfileRow = typeof schema.userProfiles.$inferSelect;
type AppConfigRow = typeof schema.appConfig.$inferSelect;

export interface ChatBackupPayload {
  sessions: ChatSessionRow[];
  messages: ChatMessageRow[];
}

export interface EntityBackupPayload {
  entity: EntityRow;
  chat: ChatBackupPayload;
  memory: {
    events: MemoryEventRow[];
    facts: MemoryFactRow[];
    summaries: MemorySummaryRow[];
    relationshipSnapshots: RelationshipSnapshotRow[];
    openLoops: OpenLoopRow[];
  };
}

export interface ConfigBackupPayload {
  providers: ProviderRow[];
  providerModels: ProviderModelRow[];
  userProfile: UserProfileRow | null;
  appConfig: AppConfigRow[];
}

export interface GlobalBackupPayload {
  entities?: EntityBackupPayload[];
  config?: ConfigBackupPayload;
}

/** Application release line; keep in sync with `soul-upload/package.json` `version`. */
export const APP_VERSION = '1.1.0.1';

// ------------------------------------------------------------
// Version migration pipeline.
// Each entry migrates a manifest FROM version `from` TO version
// `from + 1`.  The list is walked in order; the manifest is upgraded
// step-by-step until it reaches BACKUP_FORMAT_VERSION.  Pure
// functions only: do not read other zip entries or the payload here,
// because `readBackupZip` may call these before the payload is even
// decrypted.
// ------------------------------------------------------------
interface ManifestMigration {
  from: number;
  to: number;
  migrate: (m: BackupManifest) => BackupManifest;
}

const MANIFEST_MIGRATIONS: readonly ManifestMigration[] = [
  // SU-ITER-091-batch3 · v1 → v2.
  // Pre-v2 manifests had no `derivation` field because the format
  // implicitly assumed the DEK that encrypted the payload was the
  // current session DEK.  That assumption breaks once the session DEK
  // is post-migration (v2) but the backup was produced on a v1 KDF
  // install.  The migration tags the manifest with `kdfVersion: 'v1'`
  // so `backup-restore` routes the decrypt through the server-side
  // legacy-DEK endpoint instead of the session DEK path.
  //
  // The migration is pure — it cannot look up `account.salt`, which
  // lives server-side — so `saltHex` is intentionally omitted.  At
  // decrypt time the server endpoint falls back to the current
  // account's salt, which is invariant across v1→v2 because
  // `runV1ToV2Migration` keeps the account record intact.
  //
  // Note: `encrypted: false` manifests are also re-tagged for
  // completeness, but the marker is a no-op on that path since no
  // DEK is involved.
  {
    from: 1,
    to: 2,
    migrate: (m) => ({
      ...m,
      version: 2,
      derivation: m.derivation ?? { kdfVersion: 'v1' },
    }),
  },
];

/**
 * Structured error class for backup version failures.  Carries a
 * machine-readable `code` so the UI can show an i18n'd message
 * (e.g. "this backup was created with a newer version of the app")
 * without string-matching on English text.
 */
export class BackupVersionError extends Error {
  readonly code: BackupVersionErrorCode;
  readonly manifestVersion: number;
  constructor(code: BackupVersionErrorCode, manifestVersion: number, message?: string) {
    super(message ?? `${code} (manifest=${manifestVersion})`);
    this.name = 'BackupVersionError';
    this.code = code;
    this.manifestVersion = manifestVersion;
  }
}

export type BackupVersionErrorCode =
  | 'future_version_not_supported'  // manifest.version > BACKUP_FORMAT_VERSION
  | 'legacy_version_not_supported'  // manifest.version < MIN_SUPPORTED_BACKUP_VERSION
  | 'invalid_version';              // non-integer / negative / NaN

/**
 * Migrate a manifest forward to `BACKUP_FORMAT_VERSION`.
 * Throws `BackupVersionError` on unsupported inputs.
 *
 * Exported so we can unit-test the pipeline directly without
 * synthesising a full zip — keeps the migration matrix easy to cover.
 */
export function migrateBackupManifest(raw: BackupManifest): BackupManifest {
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new BackupVersionError('invalid_version', Number(v) || 0);
  }
  if (v > BACKUP_FORMAT_VERSION) {
    throw new BackupVersionError('future_version_not_supported', v);
  }
  if (v < MIN_SUPPORTED_BACKUP_VERSION) {
    throw new BackupVersionError('legacy_version_not_supported', v);
  }

  let current = raw;
  while (current.version < BACKUP_FORMAT_VERSION) {
    const step = MANIFEST_MIGRATIONS.find((m) => m.from === current.version);
    if (!step) {
      // Should not happen given the bracket guards above, but guard
      // anyway so a typo in MANIFEST_MIGRATIONS doesn't silently
      // drop a version jump.
      throw new BackupVersionError('legacy_version_not_supported', current.version);
    }
    current = step.migrate(current);
    if (current.version !== step.to) {
      throw new BackupVersionError('invalid_version', current.version,
        `migration ${step.from}->${step.to} returned version ${current.version}`);
    }
  }
  return current;
}

async function computeChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createBackupZip(
  manifest: Omit<BackupManifest, 'checksum'>,
  payloadJson: string,
): Promise<Blob> {
  const checksum = await computeChecksum(payloadJson);
  // SU-ITER-091-batch3 — v2 writes always pin kdfVersion='v2' so a
  // future v3 (or cross-account import) has an unambiguous signal
  // about how the payload DEK was derived.  `saltHex` is intentionally
  // left up to the caller: the encrypt path (`backup-crypto.encrypt
  // Payload`) may fill it, but callers producing unencrypted backups
  // can omit it without triggering the legacy-KDF decrypt branch.
  const derivation: BackupDerivationMeta =
    manifest.derivation ?? { kdfVersion: 'v2' };
  const fullManifest: BackupManifest = { ...manifest, derivation, checksum };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(fullManifest, null, 2));
  zip.file('payload.json', payloadJson);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function readBackupZip(
  file: File,
): Promise<{ manifest: BackupManifest; payloadRaw: string }> {
  const zip = await JSZip.loadAsync(file);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Invalid backup: missing manifest.json');

  const payloadFile = zip.file('payload.json');
  if (!payloadFile) throw new Error('Invalid backup: missing payload.json');

  const manifestJson = await manifestFile.async('string');
  const rawManifest: BackupManifest = JSON.parse(manifestJson);

  // Version gate: forward-migrate or reject with a typed error so the
  // UI can route on `BackupVersionError.code` rather than message text.
  const manifest = migrateBackupManifest(rawManifest);

  const payloadRaw = await payloadFile.async('string');

  const checksum = await computeChecksum(payloadRaw);
  if (checksum !== manifest.checksum) {
    throw new Error('Backup integrity check failed: checksum mismatch');
  }

  return { manifest, payloadRaw };
}

export function downloadBackupFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateBackupFilename(
  type: BackupType,
  scope: BackupScope,
  entityName?: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = entityName
    ? entityName.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, '_')
    : 'soul-upload';

  const scopeLabel = scope === 'chat-only' ? 'chat'
    : scope === 'entity-full' ? 'entity'
    : scope === 'config-only' ? 'config'
    : scope === 'all-entities' ? 'entities'
    : 'full';

  return `${prefix}-${scopeLabel}-backup-${date}${BACKUP_FILE_EXTENSION}`;
}
