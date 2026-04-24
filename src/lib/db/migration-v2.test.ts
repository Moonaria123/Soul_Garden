import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectMigrationState,
  describeMigrationStatus,
  cleanupMidMigrationResidue,
  removeV1Backup,
  removeRekeyBackup,
  recoverFromBakOnly,
  recoverFromRekeyBak,
  restoreActiveDbFromV1Backup,
  ensureV2Marker,
  __forTesting as migrationInternals,
} from './migration-v2';
import { __forTesting as connectionInternals, getDbPath } from './connection';

// ============================================================
// SU-ITER-089 · P1-1 · B8-10 — migration state-machine tests.
//
// Covers the full five-state recovery matrix produced by
// `detectMigrationState` and the filesystem housekeeping functions
// the B8-8 UI calls (`removeV1Backup`, `removeRekeyBackup`,
// `recoverFromBakOnly`, `cleanupMidMigrationResidue`).
//
// Strategy: redirect `SOUL_UPLOAD_DATA_DIR` at a per-test temp dir
// so each case starts with a clean filesystem.  We never open a real
// libsql client here — the file contents are throw-away bytes used
// only to trigger the relevant `detectMigrationState` branch.
// ============================================================

let tmpDir = '';
let dbFile = '';

function touch(filename: string, contents = 'stub'): void {
  fs.writeFileSync(path.join(tmpDir, filename), contents);
}

function exists(filename: string): boolean {
  return fs.existsSync(path.join(tmpDir, filename));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-migration-v2-'));
  process.env.SOUL_UPLOAD_DATA_DIR = tmpDir;
  connectionInternals.resetDataDirCache();
  dbFile = getDbPath();
  // Sanity: getDbPath should land inside tmpDir.
  expect(path.dirname(dbFile)).toBe(tmpDir);
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort — Windows occasionally holds onto temp files.
  }
  delete process.env.SOUL_UPLOAD_DATA_DIR;
  connectionInternals.resetDataDirCache();
});

// ------------------------------------------------------------
// detectMigrationState — five-state recovery matrix.
// ------------------------------------------------------------
describe('detectMigrationState', () => {
  it('fresh: nothing on disk → caller registers normally', () => {
    expect(detectMigrationState()).toBe('fresh');
  });

  it('migrated: .db + .db-v2-marker → v2, no action', () => {
    touch('soul-upload.db');
    touch('.db-v2-marker', 'v2\n2026-04-19T00:00:00Z\n');
    expect(detectMigrationState()).toBe('migrated');
  });

  it('needs-migration: .db without marker → v1 payload, must run wizard', () => {
    touch('soul-upload.db');
    expect(detectMigrationState()).toBe('needs-migration');
  });

  it('mid-migration: .tmp-v2 leftover', () => {
    touch('soul-upload.db');
    touch('soul-upload.db.tmp-v2');
    expect(detectMigrationState()).toBe('mid-migration');
  });

  it('mid-migration: .migrating leftover', () => {
    touch('soul-upload.db');
    touch('soul-upload.db.migrating');
    expect(detectMigrationState()).toBe('mid-migration');
  });

  it('bak-only: .db missing but .bak-v1 survived crash', () => {
    touch('soul-upload.db.bak-v1');
    expect(detectMigrationState()).toBe('bak-only');
  });

  it('rekey-bak-only: .db missing but .bak-rekey survived rekey rollback', () => {
    // Stage B Gate · code-C-2 / sec-C-2.  Distinct from bak-only so the
    // recovery UI can pick the right explanation (v1 upgrade crash vs
    // password-change crash) and so removeV1Backup / cleanupV1Backup
    // never nuke a rekey backup by accident.
    touch('soul-upload.db.bak-rekey');
    expect(detectMigrationState()).toBe('rekey-bak-only');
  });

  it('bak-only wins over rekey-bak-only when both somehow coexist', () => {
    // Defensive: the v1 backup is a once-in-a-lifetime artefact we
    // never want to lose to a newer rekey crash, so the ordering is
    // `bak-only` first.
    touch('soul-upload.db.bak-v1');
    touch('soul-upload.db.bak-rekey');
    expect(detectMigrationState()).toBe('bak-only');
  });

  it('mid-migration wins over bak-only / migrated (most-dangerous-first)', () => {
    // If a .tmp-v2 lingers it must be cleaned before the caller
    // trusts any other flag — otherwise a stale residue could be
    // misread as a valid v2 db.
    touch('soul-upload.db');
    touch('.db-v2-marker');
    touch('soul-upload.db.tmp-v2');
    expect(detectMigrationState()).toBe('mid-migration');
  });
});

// ------------------------------------------------------------
// describeMigrationStatus — the B8-8 startup report.
// ------------------------------------------------------------
describe('describeMigrationStatus', () => {
  it('reports no backups on fresh install', () => {
    expect(describeMigrationStatus()).toEqual({
      state: 'fresh',
      hasV1Backup: false,
      hasRekeyBackup: false,
    });
  });

  it('reports v1 backup flag after a completed migration', () => {
    touch('soul-upload.db');
    touch('.db-v2-marker');
    touch('soul-upload.db.bak-v1');
    expect(describeMigrationStatus()).toEqual({
      state: 'migrated',
      hasV1Backup: true,
      hasRekeyBackup: false,
    });
  });

  it('reports both backups when present', () => {
    touch('soul-upload.db');
    touch('.db-v2-marker');
    touch('soul-upload.db.bak-v1');
    touch('soul-upload.db.bak-rekey');
    expect(describeMigrationStatus()).toEqual({
      state: 'migrated',
      hasV1Backup: true,
      hasRekeyBackup: true,
    });
  });
});

// ------------------------------------------------------------
// cleanupMidMigrationResidue — idempotent, wipes .tmp-v2 / .migrating.
// ------------------------------------------------------------
describe('cleanupMidMigrationResidue', () => {
  it('removes .tmp-v2 and .migrating files', () => {
    touch('soul-upload.db');
    touch('soul-upload.db.tmp-v2');
    touch('soul-upload.db.migrating');
    cleanupMidMigrationResidue();
    expect(exists('soul-upload.db.tmp-v2')).toBe(false);
    expect(exists('soul-upload.db.migrating')).toBe(false);
    // .db itself is never touched by this helper.
    expect(exists('soul-upload.db')).toBe(true);
  });

  it('is idempotent when nothing is there', () => {
    expect(() => cleanupMidMigrationResidue()).not.toThrow();
  });
});

// ------------------------------------------------------------
// removeV1Backup / removeRekeyBackup — B8-8 cleanup actions.
// ------------------------------------------------------------
describe('removeV1Backup', () => {
  it('removes the .bak-v1 file and returns ok', () => {
    touch('soul-upload.db.bak-v1');
    const r = removeV1Backup();
    expect(r.ok).toBe(true);
    expect(exists('soul-upload.db.bak-v1')).toBe(false);
  });

  it('is idempotent when no backup is present', () => {
    const r = removeV1Backup();
    expect(r.ok).toBe(true);
  });

  it('does not touch rekey backup', () => {
    touch('soul-upload.db.bak-rekey');
    removeV1Backup();
    expect(exists('soul-upload.db.bak-rekey')).toBe(true);
  });
});

describe('removeRekeyBackup', () => {
  it('removes .bak-rekey file', () => {
    touch('soul-upload.db.bak-rekey');
    const r = removeRekeyBackup();
    expect(r.ok).toBe(true);
    expect(exists('soul-upload.db.bak-rekey')).toBe(false);
  });

  it('does not touch v1 backup', () => {
    touch('soul-upload.db.bak-v1');
    removeRekeyBackup();
    expect(exists('soul-upload.db.bak-v1')).toBe(true);
  });
});

// ------------------------------------------------------------
// recoverFromBakOnly — bak-only → migrated via one rename.
// ------------------------------------------------------------
describe('recoverFromBakOnly', () => {
  it('restores .db from .bak-v1 when state is bak-only', () => {
    touch('soul-upload.db.bak-v1', 'v1-payload');
    expect(detectMigrationState()).toBe('bak-only');
    const r = recoverFromBakOnly();
    expect(r.ok).toBe(true);
    expect(exists('soul-upload.db.bak-v1')).toBe(false);
    expect(exists('soul-upload.db')).toBe(true);
    // The restored file is now v1 payload → state reverts to
    // `needs-migration` so the user runs the wizard again.
    expect(detectMigrationState()).toBe('needs-migration');
  });

  it('refuses to run in any state other than bak-only', () => {
    touch('soul-upload.db');
    const r = recoverFromBakOnly();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detail).toContain('state=');
    }
  });
});

// ------------------------------------------------------------
// restoreActiveDbFromV1Backup — promote .bak-v1 over live .db + strip marker.
// ------------------------------------------------------------
describe('restoreActiveDbFromV1Backup', () => {
  it('refuses when .bak-v1 is missing', () => {
    touch('soul-upload.db', 'bad');
    touch('.db-v2-marker', 'v2\n');
    const r = restoreActiveDbFromV1Backup();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toBe('no_bak_v1');
  });

  it('copies bak over db, removes marker, quarantines old db', () => {
    touch('soul-upload.db', 'corrupt-v2');
    touch('.db-v2-marker', 'v2\n');
    touch('soul-upload.db.bak-v1', 'good-v1');
    expect(detectMigrationState()).toBe('migrated');
    const r = restoreActiveDbFromV1Backup();
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(dbFile, 'utf8')).toBe('good-v1');
    expect(exists('.db-v2-marker')).toBe(false);
    expect(exists('soul-upload.db.bak-v1')).toBe(true);
    expect(detectMigrationState()).toBe('needs-migration');
    const quarantined = fs.readdirSync(tmpDir).some((f) => f.startsWith('soul-upload.db.quarantine-'));
    expect(quarantined).toBe(true);
  });
});

// ------------------------------------------------------------
// recoverFromRekeyBak — rekey-bak-only → migrated (old password).
// Stage B Gate · code-C-2 / sec-C-2.
// ------------------------------------------------------------
describe('recoverFromRekeyBak', () => {
  it('restores .db from .bak-rekey when state is rekey-bak-only', () => {
    touch('soul-upload.db.bak-rekey', 'pre-rekey-payload');
    expect(detectMigrationState()).toBe('rekey-bak-only');
    const r = recoverFromRekeyBak();
    expect(r.ok).toBe(true);
    expect(exists('soul-upload.db.bak-rekey')).toBe(false);
    expect(exists('soul-upload.db')).toBe(true);
    // Restored file is the pre-rekey v2 db → state returns to
    // `needs-migration` only if no marker was present.  The restored
    // db was sealed under v2 but the marker is a separate file; the
    // test doesn't materialise it so needs-migration is the expected
    // post-state here.
    expect(detectMigrationState()).toBe('needs-migration');
  });

  it('refuses to run in any state other than rekey-bak-only', () => {
    // bak-only should take priority and NOT collapse into rekey recovery.
    touch('soul-upload.db.bak-v1');
    touch('soul-upload.db.bak-rekey');
    const r = recoverFromRekeyBak();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detail).toContain('state=bak-only');
    }
  });

  it('refuses to run when fresh (no artefacts)', () => {
    const r = recoverFromRekeyBak();
    expect(r.ok).toBe(false);
  });
});

// ------------------------------------------------------------
// ensureV2Marker — idempotent marker self-heal
// Stage B Gate · code-C-1 / sec-C-1.
// ------------------------------------------------------------
describe('ensureV2Marker', () => {
  it('writes the marker when missing and .db is present', () => {
    touch('soul-upload.db');
    expect(detectMigrationState()).toBe('needs-migration');
    const r = ensureV2Marker();
    expect(r.ok).toBe(true);
    expect(exists('.db-v2-marker')).toBe(true);
    expect(detectMigrationState()).toBe('migrated');
  });

  it('is a no-op when marker already exists', () => {
    touch('soul-upload.db');
    touch('.db-v2-marker', 'v2\n2026-04-19T00:00:00Z\n');
    const before = fs.readFileSync(path.join(tmpDir, '.db-v2-marker'), 'utf8');
    const r = ensureV2Marker();
    expect(r.ok).toBe(true);
    const after = fs.readFileSync(path.join(tmpDir, '.db-v2-marker'), 'utf8');
    // Identical bytes — the helper must NOT rewrite an existing marker,
    // otherwise a race with a concurrent reader could observe a
    // truncated file between the write and the rename.
    expect(after).toBe(before);
  });

  it('marker file contains the current MARKER_VERSION', () => {
    touch('soul-upload.db');
    ensureV2Marker();
    const content = fs.readFileSync(path.join(tmpDir, '.db-v2-marker'), 'utf8');
    expect(content.startsWith(migrationInternals.MARKER_VERSION + '\n')).toBe(true);
  });
});

// ------------------------------------------------------------
// artefact path helpers — guards against accidental renaming of
// the filesystem contract in a refactor.
// ------------------------------------------------------------
describe('artefact paths', () => {
  it('v1 migration uses .bak-v1 / .tmp-v2 / .migrating suffixes', () => {
    expect(migrationInternals.bakPath()).toBe(dbFile + '.bak-v1');
    expect(migrationInternals.tmpPath()).toBe(dbFile + '.tmp-v2');
    expect(migrationInternals.migratingPath()).toBe(dbFile + '.migrating');
  });

  it('rekey uses distinct .bak-rekey / .tmp-rekey / .rekeying suffixes', () => {
    expect(migrationInternals.rekeyBakPath()).toBe(dbFile + '.bak-rekey');
    expect(migrationInternals.rekeyTmpPath()).toBe(dbFile + '.tmp-rekey');
    expect(migrationInternals.rekeyMigratingPath()).toBe(dbFile + '.rekeying');
  });

  it('marker is versioned', () => {
    expect(migrationInternals.MARKER_VERSION).toBe('v2');
  });
});
