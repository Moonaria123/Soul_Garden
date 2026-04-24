// SU-ITER-090b · code-N-4 — migration-v2 split · v1→v2 dump-and-restore.
//
// Owns `runV1ToV2Migration`, the one-shot upgrade path for accounts
// that were created under SU-088 (v1 DEK derivation with the buggy
// `'db-encryption'` domain suffix).
//
// See the original module banner (preserved in `../migration-v2.ts`)
// for the file-system contract and three-step rename semantics.

import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../schema';
import { getDbPath, libsqlLocalFileUrl } from '../connection';
import { runMigrations } from '../migration';
import { verifyPassword } from '@/lib/crypto/password-hash';
import {
  deriveDbEncryptionKeyHex_v1_legacy,
  deriveDbEncryptionKeyHex_v2,
} from '@/lib/crypto/key-derivation-server';
import * as accountsFile from '../accounts-file';
import { secretFingerprint } from '@/lib/security/redact';
import {
  MIGRATION_TABLES,
  bakPath,
  fsLib,
  migratingPath,
  tmpPath,
  zeroize,
} from './paths';
import { copyTable } from './copy-table';
import { writeV2Marker } from './marker';
import { cleanupMidMigrationResidue, detectMigrationState } from './state';
import type { MigrationResult } from './types';

/**
 * Run the V1 → V2 migration.
 *
 * Contract:
 *   - Caller MUST have confirmed `detectMigrationState() === 'needs-migration'`.
 *   - `userId` identifies the single-user account; `password` is the user's
 *     plaintext password (localhost-only wire; same trust level as session/open).
 *   - The method verifies the password against accounts.json BEFORE touching
 *     any files, so a wrong-password attempt produces no FS side effects.
 *   - On success: .db now holds a v2-encrypted copy; .bak-v1 holds the pre-
 *     migration file for recovery; .db-v2-marker is written last.
 *   - On failure: .db is untouched; .tmp-v2 (if any) is deleted.
 *
 * Length exemption — RLX-CODE-01 (SU-092-batch3, 2026-04-19):
 * this function intentionally exceeds the 50-line architectural
 * limit.  The body is a single linear transaction that binds
 * three resources whose lifetimes cannot be split across helpers
 * without opening crypto-hygiene holes:
 *   1. Both raw DEK buffers (`v1Dek` / `v2Dek`) must be `.fill(0)`
 *      in the SAME `finally` block that allocated them, so the
 *      buffers are still addressable when the clean-up runs.
 *      Splitting into helpers would either escape the buffers
 *      through function returns (defeating zeroisation) or require
 *      wrapping the lot in an outer try/finally that would be
 *      equivalently long.
 *   2. The libsql `Client` handles must be `.close()`-d on every
 *      control-flow exit — also same scope.
 *   3. The three-step rename (`.tmp-v2` → rename → `.bak-v1` →
 *      place marker) is an atomic state machine; any helper split
 *      here invites mid-migration residue paths that SU-090b's
 *      `cleanupMidMigrationResidue` has to recover from.
 * The internal structure is annotated with numbered stages (1..5)
 * that read like a pseudo-outline for reviewers.
 */
export async function runV1ToV2Migration(opts: {
  userId: string;
  password: string;
}): Promise<MigrationResult> {
  const { userId, password } = opts;
  const t0 = Date.now();

  // Pre-flight state guard — refuse to run if the caller didn't check,
  // so we cannot clobber an already-migrated db.
  const state = detectMigrationState();
  if (state === 'mid-migration') {
    cleanupMidMigrationResidue();
    // Fall through — re-evaluate state for the real check.
  }
  const reChecked = detectMigrationState();
  if (reChecked !== 'needs-migration') {
    return { ok: false, code: 'state_conflict', detail: reChecked };
  }

  // 1. Resolve account + verify password.  We do this BEFORE deriving
  // either DEK so a bad password costs one Argon2 round, not PBKDF2 ×2.
  const account = accountsFile.getAccountById(userId);
  if (!account) {
    return { ok: false, code: 'account_not_found' };
  }
  let passwordOk = false;
  try {
    passwordOk = await verifyPassword(password, account.passwordHash);
  } catch (err) {
    return {
      ok: false,
      code: 'invalid_credentials',
      detail: err instanceof Error ? err.message : undefined,
    };
  }
  if (!passwordOk) {
    return { ok: false, code: 'invalid_credentials' };
  }

  // 2. Derive both DEKs — v1 to open the old file, v2 to seal the new.
  let v1Dek: Buffer | null = null;
  let v2Dek: Buffer | null = null;
  try {
    // Note: `v1Hex` is an immutable string and therefore not zeroisable;
    // the zeroisable artefact is `v1Dek` (a Buffer) which is .fill(0)'d
    // in the finally block below.  See
    // `deriveDbEncryptionKeyHex_v1_legacy` JSDoc for the accepted
    // residual risk rationale (one-shot migration, same-frame copies
    // already exist elsewhere, removal tracked in SU-ITER-093).
    const v1Hex = await deriveDbEncryptionKeyHex_v1_legacy(password, account.salt);
    v1Dek = Buffer.from(v1Hex, 'hex');
    v2Dek = await deriveDbEncryptionKeyHex_v2(password, account.salt);
  } catch (err) {
    zeroize(v1Dek); zeroize(v2Dek);
    return {
      ok: false,
      code: 'source_open_failed',
      detail: err instanceof Error ? err.message : 'derive_failed',
    };
  }

  // 3. Open source (v1 DEK) and target (v2 DEK) connections.  Neither goes
  // through our session map — they are short-lived and owned by this function.
  const srcPath = getDbPath();
  const dstPath = tmpPath();

  // Pre-clean any stale .tmp-v2 to avoid write-over issues.
  try {
    const fs = fsLib();
    if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
  } catch (err) {
    zeroize(v1Dek); zeroize(v2Dek);
    return {
      ok: false,
      code: 'target_write_failed',
      detail: err instanceof Error ? err.message : 'tmp_cleanup_failed',
    };
  }

  let srcClient: Client | null = null;
  let dstClient: Client | null = null;
  try {
    srcClient = createClient({
      url: libsqlLocalFileUrl(srcPath),
      encryptionKey: v1Dek.toString('hex'),
    });
    dstClient = createClient({
      url: libsqlLocalFileUrl(dstPath),
      encryptionKey: v2Dek.toString('hex'),
    });

    const dst = drizzle(dstClient, { schema });

    // Smoke-probe the source so a wrong-credentials scenario surfaces
    // as a clean error code, not a half-copied db.  `SELECT 1` also
    // forces libsql to actually open/validate the encrypted file.
    try {
      await srcClient.execute('SELECT 1');
    } catch (err) {
      srcClient.close(); dstClient.close();
      return {
        ok: false,
        code: 'source_open_failed',
        detail: err instanceof Error ? err.message : undefined,
      };
    }

    // Build target schema.  runMigrations is idempotent over
    // CREATE TABLE / CREATE INDEX, so running it here matches what a
    // brand-new v2 install would get.
    try {
      await runMigrations(dst);
    } catch (err) {
      srcClient.close(); dstClient.close();
      return {
        ok: false,
        code: 'target_write_failed',
        detail: err instanceof Error ? err.message : undefined,
      };
    }

    // Copy tables in order.  A single failure rolls the whole thing back
    // by unlinking .tmp-v2 — the source is still untouched.
    const stats: Record<string, number> = {};
    let totalRows = 0;
    for (const table of MIGRATION_TABLES) {
      let count: number;
      try {
        count = await copyTable({ srcClient, dstClient }, table);
      } catch (err) {
        srcClient.close(); dstClient.close();
        try { fsLib().unlinkSync(dstPath); } catch { /* ignore */ }
        return {
          ok: false,
          code: 'target_write_failed',
          detail: `${table}: ${err instanceof Error ? err.message : 'copy_failed'}`,
        };
      }
      stats[table] = count;
      totalRows += count;
    }

    // Both clients close BEFORE renames — Windows holds file locks
    // on open libsql connections and would refuse to rename otherwise.
    srcClient.close(); srcClient = null;
    dstClient.close(); dstClient = null;

    // 4. Three-step commit.  Semantics above.
    const fs = fsLib();
    const migratingDest = migratingPath();
    try {
      fs.renameSync(dstPath, migratingDest);       // tmp-v2 → .migrating
      fs.renameSync(srcPath, bakPath());           // .db    → .bak-v1
      fs.renameSync(migratingDest, srcPath);       // .migrating → .db
    } catch (err) {
      return {
        ok: false,
        code: 'rename_failed',
        detail: err instanceof Error ? err.message : undefined,
      };
    }

    // 5. Mark v2 last so a partial boot before this write also registers
    // as `needs-migration` rather than silently claiming v2.  If the
    // marker write fails the db itself is still v2 and openable — the
    // session/open self-heal path (probeV2DbOpenable + ensureV2Marker)
    // will retry on the next login.  Surface a distinct error code so
    // the caller can log/report without mis-diagnosing as a rename bug.
    try {
      writeV2Marker();
    } catch (err) {
      return {
        ok: false,
        code: 'marker_write_failed',
        detail: err instanceof Error ? err.message : 'marker_write_failed',
      };
    }

    const durationMs = Date.now() - t0;
    console.info(
      `[migration-v2] success user=${secretFingerprint(userId)} ` +
      `rows=${totalRows} ms=${durationMs}`,
    );

    return {
      ok: true,
      stats: { tables: stats, totalRows, durationMs },
    };
  } finally {
    // Always zero DEK material before leaving this frame.
    zeroize(v1Dek);
    zeroize(v2Dek);
    // SU-ITER-092-batch3 · A3-LOW-04 — the early-return sites inside
    // the `try` body (SELECT 1 probe / runMigrations / copyTable) also
    // close both clients explicitly before returning.  That is
    // intentional (not redundant): the `copyTable` failure path must
    // release the Windows file-lock on `.tmp-v2` BEFORE `fs.unlinkSync`
    // fires on the same line; rolling the close back here would
    // reorder those two ops and fail on Windows.  This belt-and-braces
    // block catches only the happy-path exit (where `srcClient` +
    // `dstClient` have been nulled on L213–214) and any thrown path
    // that never reached an explicit close.
    try { srcClient?.close(); } catch { /* ignore */ }
    try { dstClient?.close(); } catch { /* ignore */ }
  }
}
