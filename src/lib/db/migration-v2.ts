// SU-ITER-089 · P1-1 · B8-3 — V1 → V2 DB migration (C-plus strategy).
//
// Why this exists
// ---------------
// SU-088 P0-D shipped a DB DEK derivation that fed `(salt + 'db-encryption')`
// into a hex-parser.  The literal `'db-encryption'` is not hex, so every
// non-hex character silently became `NaN` and collapsed to zero bytes
// (@/lib/crypto/key-derivation.ts:86-127, retained with `@deprecated` for
// historical fidelity).  The resulting keys have far less entropy than the
// password suggests; they are also not domain-separated from the Client KEK.
//
// V2 derives the DB DEK server-side with a dedicated domain suffix
// (@/lib/crypto/key-derivation-server.ts :: deriveDbEncryptionKeyHex_v2).
// Existing user databases were opened with the buggy v1 key, so switching
// to v2 in-place cannot open them.  This module dumps the v1-opened
// tables and restores them into a fresh v2-opened file.
//
// File-system contract
// --------------------
//   data/soul-upload.db          // active libsql DB file
//   data/soul-upload.db.bak-v1   // ONLY present post-migration; kept until
//                                // the user clears it via UI (B8-8).
//   data/soul-upload.db.tmp-v2   // scratch file during migration; deleted
//                                // on any failure so a retry starts clean.
//   data/.db-v2-marker           // plain-text sentinel written *after* the
//                                // two renames succeed.  Absence of this
//                                // marker on an existing `.db` means the
//                                // caller MUST go through migration.
//
// Two-phase rename (atomic enough for local single-user)
// ------------------------------------------------------
//   1. tmp-v2  →  soul-upload.db-migrating     (rename 1 — commit the new file)
//   2. bak-v1  ←  soul-upload.db               (rename 2 — move old out of the way)
//   3. db-migrating  →  soul-upload.db         (rename 3 — put new in place)
//   4. write  .db-v2-marker                    (marker)
//
// Windows does not support atomic file swap, but because both renames
// live in the same directory and are each individually atomic, any crash
// between steps leaves exactly one of `{soul-upload.db, soul-upload.db-migrating,
// soul-upload.db.bak-v1}` pointing at a coherent database.  `detectMigrationState`
// inspects the residue on next boot and routes the caller to a cleanup path.
//
// SU-ITER-090b · code-N-4 — split into submodules.
// This file is now a barrel that re-exports the public surface so
// callers (API routes, tests) keep their existing import paths.  The
// real logic lives under `./migration-v2/` in focused modules:
//   - `paths.ts`       — filename constants, path helpers, `MIGRATION_TABLES`.
//   - `types.ts`       — shared result shapes and error codes.
//   - `state.ts`       — state-machine classification + housekeeping.
//   - `marker.ts`      — marker writer, self-heal, and v2 probe.
//   - `copy-table.ts`  — shared dump-and-restore row copier.
//   - `v1-to-v2.ts`    — `runV1ToV2Migration` (one-shot upgrade).
//   - `rekey.ts`       — `runChangePassword` (R1-style password rotation).

import { guardTestingHooks } from '@/lib/security/testing-hooks-guard';
import {
  MARKER_VERSION,
  MIGRATION_TABLES,
  bakPath,
  markerPath,
  migratingPath,
  rekeyBakPath,
  rekeyMigratingPath,
  rekeyTmpPath,
  tmpPath,
} from './migration-v2/paths';

export type {
  MigrationState,
  MigrationStats,
  MigrationResult,
  MigrationErrorCode,
  ChangePasswordStats,
  ChangePasswordResult,
  MigrationStatusReport,
} from './migration-v2/types';

export {
  detectMigrationState,
  describeMigrationStatus,
  cleanupMidMigrationResidue,
  removeV1Backup,
  removeRekeyBackup,
  recoverFromBakOnly,
  recoverFromRekeyBak,
  restoreActiveDbFromV1Backup,
} from './migration-v2/state';

export {
  ensureV2Marker,
  probeV1DbOpenable,
  probeV2DbOpenable,
  repairFalseMigratedMarker,
  repairFalseV2MarkerAfterNotadbOnSchemaDdl,
} from './migration-v2/marker';
export type {
  RepairAfterNotadbSchemaDdlResult,
  RepairFalseMigratedResult,
} from './migration-v2/marker';
export { runV1ToV2Migration } from './migration-v2/v1-to-v2';
export { runChangePassword } from './migration-v2/rekey';

/**
 * Test-only hooks — exposed under a namespace so production code can't
 * call them accidentally.  Re-uses the `guardTestingHooks` Proxy
 * (SU-ITER-090a · code-N-2) so any `get` / `set` / `deleteProperty` /
 * `defineProperty` against this namespace in production throws unless
 * `SU_ALLOW_TEST_HOOKS=1` is explicitly set.
 */
export const __forTesting = guardTestingHooks('db/migration-v2', {
  MIGRATION_TABLES,
  markerPath,
  bakPath,
  tmpPath,
  migratingPath,
  rekeyBakPath,
  rekeyTmpPath,
  rekeyMigratingPath,
  MARKER_VERSION,
});
