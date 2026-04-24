// SU-ITER-090b · code-N-4 — migration-v2 split · marker & probe.
//
// Handles:
//   - `writeV2Marker` — crash-safe placement of `.db-v2-marker` (atomic
//     rename preferred; direct-overwrite fallback to avoid deadlock when
//     cross-name rename is unavailable, e.g. Windows / read-only
//     filesystems).
//   - `ensureV2Marker` — self-healing marker write called by session/open
//     after it has probed the v2 DEK is correct.
//   - `probeV2DbOpenable` — short-lived libsql open used to distinguish
//     "v1 db + marker missing" from "v2 db + marker missing" so
//     legitimate users don't get trapped in a migration loop.
//
// Importantly: this module does NOT own the 3-step rename commit.  It
// is called from `v1-to-v2.ts::runV1ToV2Migration` as the final step of
// that commit, and independently from `/session/open` when we detect
// `needs-migration` yet suspect a missing marker.

import { createClient, type Client } from '@libsql/client';
import { getDbPath, libsqlLocalFileUrl } from '../connection';
import {
  deriveDbEncryptionKeyHex_v1_legacy,
  deriveDbEncryptionKeyHex_v2,
} from '@/lib/crypto/key-derivation-server';
import { MARKER_VERSION, fsLib, markerPath, pathLib, zeroize } from './paths';
import { detectMigrationState } from './state';

/**
 * Write the v2 marker — atomically when possible, with a plain-write
 * fallback when rename is unavailable (e.g. Windows file-system quirks
 * or read-only filesystems briefly denying cross-name rename).
 *
 * Called after the two db renames succeed so its presence really does
 * imply v2.  The fallback path preserves the invariant: the marker file
 * on disk at the end of a successful return always contains the
 * current MARKER_VERSION.
 *
 * Hardened 2026-04-19 (B8 Stage B Gate · code-C-1 / sec-C-1) after
 * reviewers flagged a potential deadlock where a rename-only
 * implementation could strand a committed v2 db without a marker,
 * forcing the user through a migration loop on next boot.
 */
export function writeV2Marker(): void {
  const fs = fsLib();
  const path = pathLib();
  const marker = markerPath();
  const tmp = marker + '.writing';
  const content = `${MARKER_VERSION}\n${new Date().toISOString()}\n`;

  // Preferred path: write-then-rename (crash-safe on POSIX).
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, marker);
    return;
  } catch (renameErr) {
    // Fallback: direct overwrite of the marker file.  Accept the
    // (tiny) window where a crash during this second write leaves
    // the marker truncated — the next boot will observe
    // `needs-migration`, probe v2 openability in session/open, and
    // self-heal via ensureV2Marker() rather than dead-locking the user.
    try {
      fs.writeFileSync(marker, content, 'utf8');
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return;
    } catch (writeErr) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      const reason = writeErr instanceof Error ? writeErr.message
        : renameErr instanceof Error ? renameErr.message
        : 'unknown';
      throw new Error(`failed to place ${path.basename(marker)}: ${reason}`);
    }
  }
}

/**
 * Self-healing marker write for the session/open path.
 *
 * Context: if a prior migration committed the 3-step db rename but then
 * failed to place `.db-v2-marker` (disk full, permissions flip between
 * renames, crash between rename-3 and marker write), the next boot
 * sees `detectMigrationState() === 'needs-migration'` even though the
 * on-disk .db is actually v2 and openable with the v2 DEK.
 *
 * `ensureV2Marker` is the targeted recovery: the caller has already
 * confirmed (via `probeV2DbOpenable`) that the current .db decrypts
 * cleanly under the v2 DEK.  We then write the marker so subsequent
 * boots report `'migrated'` and the login path stops prompting for a
 * bogus re-migration.
 *
 * Idempotent and crash-safe: if the marker already exists, we return
 * silently (no FS writes).  If the write fails, we surface the error
 * so the caller can fall back to the standard `migration_required`
 * 409; the user can still complete migration manually.
 */
export function ensureV2Marker(): { ok: true } | { ok: false; detail: string } {
  const fs = fsLib();
  try {
    if (fs.existsSync(markerPath())) return { ok: true };
    writeV2Marker();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'marker_write_failed',
    };
  }
}

/**
 * Probe whether the current `.db` can be opened with the v2 DEK derived
 * from (password, account.salt).  Used by session/open to auto-recover
 * from a missing-marker state (see `ensureV2Marker`).
 *
 * Returns `{ ok: true }` when the DB decrypts + a trivial `SELECT 1`
 * succeeds.  Any failure path (wrong DEK, IO error, libsql refusal)
 * collapses to `{ ok: false }` with a redacted detail — this helper
 * deliberately does NOT distinguish "wrong password" from "genuinely
 * v1 database" because both resolve the same way: fall back to the
 * normal migration wizard.
 *
 * Important: uses a short-lived libsql client that is closed on every
 * exit path.  The returned hex key is zeroised via the owning Buffer
 * on the caller's behalf so we do not leak the DEK to the heap for
 * longer than the probe itself.
 */
export async function probeV2DbOpenable(opts: {
  password: string;
  saltHex: string;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  let dek: Buffer | null = null;
  let client: Client | null = null;
  try {
    dek = await deriveDbEncryptionKeyHex_v2(opts.password, opts.saltHex);
    client = createClient({
      url: libsqlLocalFileUrl(getDbPath()),
      encryptionKey: dek.toString('hex'),
    });
    await client.execute('SELECT 1');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'probe_failed',
    };
  } finally {
    try { client?.close(); } catch { /* ignore */ }
    zeroize(dek);
  }
}

/**
 * Probe whether the current `.db` can be opened with the legacy v1 DEK.
 * Used to detect "false migrated" (marker present but file is still v1-encrypted).
 */
export async function probeV1DbOpenable(opts: {
  password: string;
  saltHex: string;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  let dek: Buffer | null = null;
  let client: Client | null = null;
  try {
    const v1Hex = await deriveDbEncryptionKeyHex_v1_legacy(opts.password, opts.saltHex);
    dek = Buffer.from(v1Hex, 'hex');
    client = createClient({
      url: libsqlLocalFileUrl(getDbPath()),
      encryptionKey: dek.toString('hex'),
    });
    await client.execute('SELECT 1');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'probe_failed',
    };
  } finally {
    try { client?.close(); } catch { /* ignore */ }
    zeroize(dek);
  }
}

export type RepairFalseMigratedResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'not_migrated_state'
        | 'v2_already_openable'
        | 'v1_not_openable'
        | 'unlink_failed';
      detail?: string;
    };

/**
 * When `.db-v2-marker` exists but the file is not actually v2 under the user's
 * credentials (common after a bad self-heal / copied profile), v2 probe / DDL
 * fails while v1 can still open the file.  Remove only the marker so
 * `detectMigrationState()` becomes `needs-migration` and the normal v1→v2
 * pipeline can run.
 *
 * If v2 already opens, the marker is consistent with content — refuse.
 * If neither v1 nor v2 opens, refuse (corrupt or wrong password).
 */
export async function repairFalseMigratedMarker(opts: {
  password: string;
  saltHex: string;
}): Promise<RepairFalseMigratedResult> {
  if (detectMigrationState() !== 'migrated') {
    return { ok: false, code: 'not_migrated_state' };
  }

  const v2 = await probeV2DbOpenable(opts);
  if (v2.ok) {
    return { ok: false, code: 'v2_already_openable' };
  }

  const v1 = await probeV1DbOpenable(opts);
  if (!v1.ok) {
    return { ok: false, code: 'v1_not_openable', detail: v1.detail };
  }

  const fs = fsLib();
  try {
    fs.unlinkSync(markerPath());
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: 'unlink_failed',
      detail: err instanceof Error ? err.message : 'unlink_failed',
    };
  }
}

export type RepairAfterNotadbSchemaDdlResult =
  | { ok: true }
  | {
      ok: false;
      code: 'not_migrated_state' | 'v1_not_openable' | 'unlink_failed';
      detail?: string;
    };

/**
 * After `session/open` runs `openDatabase` + `runMigrations`, the first DDL
 * (`CREATE TABLE schema_migrations`) can fail with SQLITE_NOTADB while an
 * earlier `probeV2DbOpenable` still returned success (trivial `SELECT 1`).
 * In that situation {@link repairFalseMigratedMarker} refuses to unlink the
 * marker because it treats `probeV2DbOpenable === ok` as proof of v2.
 *
 * When we already observed NOTADB on the migration bookkeeping DDL, trust
 * that failure over the lightweight probe: if the v2 marker is present and
 * the file still opens with the legacy v1 DEK, remove only the marker so the
 * normal v1→v2 wizard can run.
 */
export async function repairFalseV2MarkerAfterNotadbOnSchemaDdl(opts: {
  password: string;
  saltHex: string;
}): Promise<RepairAfterNotadbSchemaDdlResult> {
  if (detectMigrationState() !== 'migrated') {
    return { ok: false, code: 'not_migrated_state' };
  }

  const v1 = await probeV1DbOpenable(opts);
  if (!v1.ok) {
    return { ok: false, code: 'v1_not_openable', detail: v1.detail };
  }

  const fs = fsLib();
  try {
    fs.unlinkSync(markerPath());
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: 'unlink_failed',
      detail: err instanceof Error ? err.message : 'unlink_failed',
    };
  }
}
