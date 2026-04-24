// SU-ITER-090b · code-N-4 — migration-v2 split · shared types.
//
// All result shapes and error codes live here so the split modules
// (`state.ts`, `v1-to-v2.ts`, `rekey.ts`, …) share one source of truth
// without circular imports.

export type MigrationState =
  | 'fresh'            // no .db file — first install; caller registers normally.
  | 'migrated'         // .db present + marker present — v2, no action needed.
  | 'needs-migration'  // .db present + marker absent — v1 payload, must migrate.
  | 'mid-migration'    // .tmp-v2 or .migrating leftover — prior attempt crashed.
  | 'bak-only'         // .bak-v1 present but .db gone — extreme crash window.
  | 'rekey-bak-only';  // .bak-rekey present but .db gone — rekey rollback
                       // failed halfway (see runChangePassword step 7).
                       // Added 2026-04-19 (B8 Stage B Gate · code-C-2 / sec-C-2).

export interface MigrationStats {
  tables: Record<string, number>;
  totalRows: number;
  /** Wall-clock ms, for dev-time diagnostics only. */
  durationMs: number;
}

export type MigrationResult =
  | { ok: true; stats: MigrationStats }
  | { ok: false; code: MigrationErrorCode; detail?: string };

export type MigrationErrorCode =
  | 'invalid_credentials'   // password verify failed; no FS side effects.
  | 'account_not_found'     // userId absent from accounts.json.
  | 'no_source_db'          // .db missing — nothing to migrate.
  | 'source_open_failed'    // libsql refused to open with the v1 DEK.
  | 'target_write_failed'   // createClient/runMigrations/INSERT failed.
  | 'rename_failed'         // FS rename failed mid-commit.
  | 'marker_write_failed'   // 3-step rename succeeded but the .db-v2-marker
                            // sentinel could not be persisted.  Distinct
                            // from rename_failed so the session/open
                            // fallback (probeV2 + ensureV2Marker) can
                            // recognise and self-heal.  Added 2026-04-19
                            // (B8 Stage B Gate · code-C-1 / sec-C-1).
  | 'state_conflict'        // called when detectMigrationState ≠ 'needs-migration'.
  // SU-ITER-089 · P1-1 · B8-5 — change-password additions.
  | 'weak_password'         // newPassword fails strength policy (server-side gate).
  | 'accounts_write_failed'; // rekey succeeded but accounts.json write failed (rolled back).

export interface ChangePasswordStats {
  tables: Record<string, number>;
  totalRows: number;
  durationMs: number;
}

export type ChangePasswordResult =
  | { ok: true; stats: ChangePasswordStats }
  | { ok: false; code: MigrationErrorCode; detail?: string };

/**
 * Extended startup report for the B8-8 cleanup UI.
 *
 * The UI routes on `state` primarily, but the two auxiliary flags let
 * the client surface optional clean-up affordances without running a
 * second round-trip:
 *   - `hasV1Backup` true means `.bak-v1` is still on disk from a prior
 *     v1→v2 migration; the user can safely remove it once they're sure
 *     v2 works.
 *   - `hasRekeyBackup` true means `.bak-rekey` is still on disk from
 *     the most recent password rotation; kept as a recovery net for
 *     one cycle but also safely removable.
 */
export interface MigrationStatusReport {
  state: MigrationState;
  hasV1Backup: boolean;
  hasRekeyBackup: boolean;
}
