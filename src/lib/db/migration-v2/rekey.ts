// SU-ITER-090b · code-N-4 — migration-v2 split · change-password rekey.
//
// Owns `runChangePassword`, the server-side dump-and-restore used by
// `/api/accounts/change-password` (SU-ITER-089 · B8-5 · R1 strategy).
// See the original module banner (preserved in `../migration-v2.ts`)
// for the rationale and contract.

import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../schema';
import { closeAllDatabases, getDbPath, libsqlLocalFileUrl } from '../connection';
import { runMigrations } from '../migration';
import { verifyPassword, hashPassword } from '@/lib/crypto/password-hash';
import { deriveDbEncryptionKeyHex_v2 } from '@/lib/crypto/key-derivation-server';
import * as accountsFile from '../accounts-file';
import { secretFingerprint } from '@/lib/security/redact';
import { validatePasswordStrength } from '@/lib/auth/password-strength';
import {
  MIGRATION_TABLES,
  fsLib,
  rekeyBakPath,
  rekeyMigratingPath,
  rekeyTmpPath,
  zeroize,
} from './paths';
import { copyTable } from './copy-table';
import { detectMigrationState } from './state';
import type { ChangePasswordResult } from './types';

/**
 * Run a server-side change-password rekey.
 *
 * SU-ITER-089 · P1-1 · B8-5 — R1 strategy (selected by user on 2026-04-19).
 * libsql/SQLCipher has no in-place PRAGMA rekey, so a password rotation
 * is structurally identical to the v1→v2 migration: dump every table,
 * restore into a fresh v2-encrypted file sealed with the new DEK, then
 * atomically swap.  The only real differences from `runV1ToV2Migration`:
 *   - Both source and target use the v2 derivation (same domain suffix).
 *   - We generate a fresh Argon2id salt for the new password and write
 *     both the new hash and the new salt back to accounts.json under an
 *     atomic `write-then-rename` (see `accounts-file.ts::writeAccountsFile`).
 *   - Backup lives at `.bak-rekey` (distinct from `.bak-v1`) so the v1
 *     cleanup UI (B8-8) can tell them apart.
 *   - If the accounts.json update fails AFTER the db swap, we roll the
 *     db back from `.bak-rekey` so the user's old password still works
 *     — the partial-commit window is a few milliseconds at worst.
 *
 * Contract:
 *   - Caller MUST have confirmed the DB is already v2 (i.e.
 *     `detectMigrationState()` returns `'migrated'`); we re-check here
 *     and refuse with `state_conflict` otherwise.
 *   - `currentPassword` and `newPassword` are plaintext — same trust
 *     model as `/session/open` (localhost same-origin).
 *   - On success, all in-memory DB sessions are evicted so the client
 *     must re-authenticate; this guarantees no stale session still
 *     holds the old DEK.
 *
 * Length exemption — RLX-CODE-01 (SU-092-batch3, 2026-04-19):
 * same rationale as `runV1ToV2Migration` — this function exceeds
 * the 50-line architectural limit because the old-DEK buffer, the
 * new-DEK buffer, the libsql `Client` handles, and the three-step
 * atomic rename (`.tmp-rekey` → rename → `.bak-rekey`) must all
 * live in the same lexical scope to be `.fill(0)`/`.close()`-d on
 * every exit path without escaping zeroisable material through
 * helper returns.  The ADDITIONAL reason here vs v1-to-v2: the
 * accounts.json update is the final commit step AFTER the db
 * swap, and on partial failure we roll the db back from
 * `.bak-rekey` so the user's old password still works — that
 * recovery path needs the live `.bak-rekey` fsLib handle which
 * would be awkward to thread through a helper boundary.  The
 * numbered stages (1..6) in the body read like a pseudo-outline
 * for reviewers.
 */
export async function runChangePassword(opts: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const { userId, currentPassword, newPassword } = opts;
  const t0 = Date.now();

  // 0. Pre-flight state guard.  Change-password only runs on a live v2
  // database — for anything else the migration wizard is the right path.
  const state = detectMigrationState();
  if (state !== 'migrated') {
    return { ok: false, code: 'state_conflict', detail: state };
  }

  // 1. Resolve account + verify current password before any key derivation.
  const account = accountsFile.getAccountById(userId);
  if (!account) {
    return { ok: false, code: 'account_not_found' };
  }
  let passwordOk = false;
  try {
    passwordOk = await verifyPassword(currentPassword, account.passwordHash);
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

  // 2. Server-side strength gate (belt + braces — the UI enforces this too,
  // but a tampered client could bypass).  Reuses the same policy module
  // used by registration so the rules stay in sync.
  const strength = validatePasswordStrength(newPassword, {
    username: account.username,
  });
  if (!strength.ok) {
    return {
      ok: false,
      code: 'weak_password',
      detail: strength.reasons.join(','),
    };
  }

  // 3. Hash the new password with a FRESH salt.  We do this before
  // deriving DEKs so an Argon2 failure costs no FS activity.
  let newHash: string;
  let newSalt: string;
  try {
    const hashed = await hashPassword(newPassword);
    newHash = hashed.hash;
    newSalt = hashed.salt;
  } catch (err) {
    return {
      ok: false,
      code: 'target_write_failed',
      detail: err instanceof Error ? err.message : 'hash_failed',
    };
  }

  // 4. Derive both DEKs using the v2 domain.  `oldDek` opens the current
  // .db; `newDek` seals the rekey target.
  let oldDek: Buffer | null = null;
  let newDek: Buffer | null = null;
  try {
    oldDek = await deriveDbEncryptionKeyHex_v2(currentPassword, account.salt);
    newDek = await deriveDbEncryptionKeyHex_v2(newPassword, newSalt);
  } catch (err) {
    zeroize(oldDek); zeroize(newDek);
    return {
      ok: false,
      code: 'source_open_failed',
      detail: err instanceof Error ? err.message : 'derive_failed',
    };
  }

  // 5. Evict any live DB session so libsql can release the file lock
  // (Windows refuses rename-over-open-handle).  The client will be
  // forced to re-authenticate after the rekey commits.
  try {
    closeAllDatabases();
  } catch (err) {
    console.warn('[migration-v2] closeAllDatabases during rekey:', err);
    // Non-fatal — if no sessions were open this is a noop; if some
    // failed to close we will discover that via the srcClient open.
  }

  const srcPath = getDbPath();
  const dstPath = rekeyTmpPath();

  // Pre-clean any stale .tmp-rekey from a prior interrupted attempt.
  try {
    const fs = fsLib();
    if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
  } catch (err) {
    zeroize(oldDek); zeroize(newDek);
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
      encryptionKey: oldDek.toString('hex'),
    });
    dstClient = createClient({
      url: libsqlLocalFileUrl(dstPath),
      encryptionKey: newDek.toString('hex'),
    });
    const dst = drizzle(dstClient, { schema });

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

    srcClient.close(); srcClient = null;
    dstClient.close(); dstClient = null;

    // 6. Three-step commit — identical semantics to runV1ToV2Migration
    // but with rekey-specific artefact names.  A prior `.bak-rekey` (if
    // any) is overwritten by the rename; we keep only the most recent
    // rekey backup.
    const fs = fsLib();
    const migratingDest = rekeyMigratingPath();
    const bakDest = rekeyBakPath();
    try {
      if (fs.existsSync(bakDest)) fs.unlinkSync(bakDest);
      fs.renameSync(dstPath, migratingDest);      // tmp-rekey → .rekeying
      fs.renameSync(srcPath, bakDest);            // .db       → .bak-rekey
      fs.renameSync(migratingDest, srcPath);      // .rekeying → .db
    } catch (err) {
      return {
        ok: false,
        code: 'rename_failed',
        detail: err instanceof Error ? err.message : undefined,
      };
    }

    // 7. Persist new credentials.  If this fails we must roll the db
    // back from .bak-rekey so the user can still log in with the old
    // password — otherwise both passwords become invalid (the old
    // one is in accounts.json but the db DEK has already moved on).
    try {
      const next = {
        ...account,
        passwordHash: newHash,
        salt: newSalt,
        // Password rotation is a login-success-equivalent event;
        // reset lockout counters to match.
        failedAttempts: 0,
        lockUntil: null,
      };
      accountsFile.putAccount(next);
    } catch (err) {
      // Roll the db back: remove the new (re-keyed) file and promote
      // the old backup back to `.db`.  If either step fails we leave
      // a clearly-named backup for manual recovery and surface
      // accounts_write_failed to the caller.
      try {
        if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
        if (fs.existsSync(bakDest)) fs.renameSync(bakDest, srcPath);
      } catch (rollbackErr) {
        console.error(
          '[migration-v2] rekey rollback failed — bak-rekey may still be present:',
          rollbackErr,
        );
      }
      return {
        ok: false,
        code: 'accounts_write_failed',
        detail: err instanceof Error ? err.message : 'accounts_put_failed',
      };
    }

    const durationMs = Date.now() - t0;
    console.info(
      `[migration-v2] rekey success user=${secretFingerprint(userId)} ` +
      `rows=${totalRows} ms=${durationMs}`,
    );

    return {
      ok: true,
      stats: { tables: stats, totalRows, durationMs },
    };
  } finally {
    zeroize(oldDek);
    zeroize(newDek);
    try { srcClient?.close(); } catch { /* ignore */ }
    try { dstClient?.close(); } catch { /* ignore */ }
  }
}
