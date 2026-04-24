// SU-ITER-090b · code-N-4 — migration-v2 split · paths & constants.
//
// Pulled out of the former `migration-v2.ts` monolith (929 lines > 800 cap).
// Owns:
//   - On-disk filename suffixes and the marker filename.
//   - Path helpers that resolve those names against the live
//     `getDataDir()` / `getDbPath()` from `../connection`.
//   - The compile-time whitelist of tables copied by dump-and-restore
//     (`MIGRATION_TABLES`) and a Buffer zeroisation helper.
//
// Lazy `fsLib()` / `pathLib()` helpers route through `hiddenRequire` so
// Turbopack's Node File Trace does not pull these Node-only modules
// into the deploy bundle (see `@/lib/utils/hidden-require` rationale).

import { getDataDir, getDbPath } from '../connection';
import { hiddenRequire as _require } from '@/lib/utils/hidden-require';

export const MARKER_FILENAME = '.db-v2-marker';
export const BAK_SUFFIX = '.bak-v1';
export const TMP_SUFFIX = '.tmp-v2';
export const MIGRATING_SUFFIX = '.migrating';
export const MARKER_VERSION = 'v2';

// SU-ITER-089 · P1-1 · B8-5 — change-password rekey artefacts.
// Distinct from .bak-v1 so a later v1-cleanup prompt (B8-8) doesn't
// accidentally wipe a just-made rekey backup, and vice versa.
export const REKEY_BAK_SUFFIX = '.bak-rekey';
export const REKEY_TMP_SUFFIX = '.tmp-rekey';
export const REKEY_MIGRATING_SUFFIX = '.rekeying';

// Tables copied in FK-safe order.  `schema_migrations` is intentionally
// omitted — the target database runs `runMigrations` itself, which both
// creates the bookkeeping table and stamps every applied version.
export const MIGRATION_TABLES = [
  'providers',
  'provider_models',
  'entities',
  'chat_sessions',
  'chat_messages',
  'session_state',
  'memory_events',
  'memory_facts',
  'memory_summaries',
  'relationship_snapshots',
  'open_loops',
  'memory_embeddings',
  'user_profiles',
  'drafts',
  'app_config',
] as const;

export function pathLib(): typeof import('path') {
  return _require('path') as typeof import('path');
}
export function fsLib(): typeof import('fs') {
  return _require('fs') as typeof import('fs');
}

export function markerPath(): string {
  return pathLib().join(getDataDir(), MARKER_FILENAME);
}

export function bakPath(): string {
  return getDbPath() + BAK_SUFFIX;
}

export function tmpPath(): string {
  return getDbPath() + TMP_SUFFIX;
}

export function migratingPath(): string {
  return getDbPath() + MIGRATING_SUFFIX;
}

export function rekeyBakPath(): string {
  return getDbPath() + REKEY_BAK_SUFFIX;
}

export function rekeyTmpPath(): string {
  return getDbPath() + REKEY_TMP_SUFFIX;
}

export function rekeyMigratingPath(): string {
  return getDbPath() + REKEY_MIGRATING_SUFFIX;
}

/** Best-effort zeroise of a Buffer; noop on null. */
export function zeroize(buf: Buffer | null): void {
  if (buf) buf.fill(0);
}
