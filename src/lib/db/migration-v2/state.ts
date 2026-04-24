// SU-ITER-090b · code-N-4 — migration-v2 split · state machine & cleanup.
//
// Responsibilities:
//   - Inspect on-disk residue and classify the database's migration state.
//   - Housekeeping primitives used by the B8-8 startup health check UI
//     (`describeMigrationStatus`, `cleanupMidMigrationResidue`,
//     `removeV1Backup`, `removeRekeyBackup`, `recoverFromBakOnly`,
//     `recoverFromRekeyBak`, `restoreActiveDbFromV1Backup`).
//
// Mostly pure filesystem introspection; `restoreActiveDbFromV1Backup` copies
// bytes and must run only when libsql has released the DB file (API route
// closes sessions first).

import { getDbPath } from '../connection';
import {
  fsLib,
  bakPath,
  markerPath,
  migratingPath,
  rekeyBakPath,
  tmpPath,
} from './paths';
import type { MigrationState, MigrationStatusReport } from './types';

export function detectMigrationState(): MigrationState {
  const fs = fsLib();
  const dbExists = fs.existsSync(getDbPath());
  const markerExists = fs.existsSync(markerPath());
  const tmpExists = fs.existsSync(tmpPath());
  const migratingExists = fs.existsSync(migratingPath());
  const bakExists = fs.existsSync(bakPath());
  const rekeyBakExists = fs.existsSync(rekeyBakPath());

  if (tmpExists || migratingExists) return 'mid-migration';
  // Priority: .bak-v1 beats .bak-rekey if both somehow coexist — the
  // v1 backup is a once-in-a-lifetime artefact and should never be
  // lost to a newer rekey crash.
  if (!dbExists && bakExists) return 'bak-only';
  if (!dbExists && rekeyBakExists) return 'rekey-bak-only';
  if (!dbExists) return 'fresh';
  if (markerExists) return 'migrated';
  return 'needs-migration';
}

export function describeMigrationStatus(): MigrationStatusReport {
  const fs = fsLib();
  return {
    state: detectMigrationState(),
    hasV1Backup: fs.existsSync(bakPath()),
    hasRekeyBackup: fs.existsSync(rekeyBakPath()),
  };
}

/**
 * Clean residual .tmp-v2 / .migrating files from a prior interrupted run
 * so a retry starts from a known state.  Idempotent; safe to call on any
 * boot.
 */
export function cleanupMidMigrationResidue(): void {
  const fs = fsLib();
  for (const p of [tmpPath(), migratingPath()]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      console.warn('[migration-v2] cleanup residue failed:', p, err);
    }
  }
}

/**
 * Remove the .bak-v1 backup produced by a one-time v1→v2 migration.
 * Exposed so the UI cleanup prompt (B8-8) can wipe the historical
 * backup once the user confirms they no longer need it.  Idempotent.
 */
export function removeV1Backup(): { ok: true } | { ok: false; detail: string } {
  const fs = fsLib();
  try {
    const p = bakPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'unlink_failed',
    };
  }
}

/**
 * Remove the .bak-rekey backup left by the most recent password
 * rotation.  Symmetric to removeV1Backup; B8-8 offers both as one-
 * click clean-up actions in the same UI surface.  Idempotent.
 */
export function removeRekeyBackup(): { ok: true } | { ok: false; detail: string } {
  const fs = fsLib();
  try {
    const p = rekeyBakPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'unlink_failed',
    };
  }
}

/**
 * Recover from the `bak-only` state by promoting the .bak-v1 backup
 * back into `.db`.  This is the last-resort path if the v1→v2 commit
 * window crashed between rename 2 and rename 3; the `.db` is missing
 * but the backup survived.  Safe to call only from that exact state.
 */
export function recoverFromBakOnly(): { ok: true } | { ok: false; detail: string } {
  const fs = fsLib();
  const state = detectMigrationState();
  if (state !== 'bak-only') {
    return { ok: false, detail: `state=${state}` };
  }
  try {
    fs.renameSync(bakPath(), getDbPath());
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'recover_failed',
    };
  }
}

/**
 * Replace the active `soul-upload.db` with a copy of `soul-upload.db.bak-v1`
 * and remove `.db-v2-marker` so the install reports `needs-migration` again.
 *
 * Use when the live DB is corrupt / false-migrated but the v1-era backup from
 * a prior successful v1→v2 rename still exists. Refuses if `.bak-v1` is absent.
 * Caller MUST close libsql sessions before invoking (see API route).
 */
export function restoreActiveDbFromV1Backup(): { ok: true } | { ok: false; detail: string } {
  const fs = fsLib();
  const db = getDbPath();
  const bak = bakPath();
  if (!fs.existsSync(bak)) {
    return { ok: false, detail: 'no_bak_v1' };
  }

  cleanupMidMigrationResidue();

  const tmp = `${db}.restore-swap-${Date.now()}`;
  let quarantine: string | null = null;
  try {
    fs.copyFileSync(bak, tmp);
    if (fs.existsSync(db)) {
      quarantine = `${db}.quarantine-${Date.now()}`;
      fs.renameSync(db, quarantine);
    }
    fs.renameSync(tmp, db);
    const marker = markerPath();
    if (fs.existsSync(marker)) {
      fs.unlinkSync(marker);
    }
    return { ok: true };
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      if (quarantine !== null && fs.existsSync(quarantine) && !fs.existsSync(db)) {
        fs.renameSync(quarantine, db);
      }
    } catch {
      /* best-effort rollback */
    }
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'restore_failed',
    };
  }
}

/**
 * Recover from the `rekey-bak-only` state by promoting the .bak-rekey
 * backup back into `.db`.  This state only arises if `runChangePassword`
 * suffered a double failure: the db swap succeeded, the accounts.json
 * write failed, AND the rollback (unlink new .db + rename bak back)
 * also failed between its two steps — leaving the active file deleted
 * but the pre-rekey backup intact.
 *
 * CRITICAL: accounts.json at this point still holds the OLD
 * password hash + salt (the change-password transaction was aborted),
 * so promoting .bak-rekey (which was sealed with the old DEK) is the
 * correct recovery.  Users log in with their old password.
 *
 * Added 2026-04-19 (B8 Stage B Gate · code-C-2 / sec-C-2).  Idempotent
 * and state-guarded; refuses to run unless `detectMigrationState()`
 * returns exactly `'rekey-bak-only'`.
 */
export function recoverFromRekeyBak(): { ok: true } | { ok: false; detail: string } {
  const fs = fsLib();
  const state = detectMigrationState();
  if (state !== 'rekey-bak-only') {
    return { ok: false, detail: `state=${state}` };
  }
  try {
    fs.renameSync(rekeyBakPath(), getDbPath());
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'recover_failed',
    };
  }
}
