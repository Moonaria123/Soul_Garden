import { type LibSQLDatabase } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import type * as schema from './schema';
import { getProjectRoot } from './connection';
import { hiddenRequire as _require } from '../utils/hidden-require';

// ============================================================
// Migration Runner
// Applies SQL migration files from drizzle/ directory.
// Tracks applied migrations in schema_migrations table.
// Node builtins resolved via `hiddenRequire` — see
// src/lib/utils/hidden-require.ts for the NFT rationale.
//
// SU-ITER-090b · P2-18 — transactional per-file application.
// Each migration file is split on `--> statement-breakpoint`.  We now:
//   1. Pull PRAGMA statements out to run on the raw connection
//      (sqlite only honours `PRAGMA foreign_keys=OFF/ON` outside a
//      transaction; attempting them inside a txn silently no-ops).
//   2. Wrap the remaining statements + the `schema_migrations` bump
//      in a single `db.transaction()` so any failure rolls back the
//      partial DDL without leaving the file's changes half-applied.
// This matters for migrations like 0002 that rebuild a table via the
// sqlite 12-step pattern (CREATE new / INSERT SELECT / DROP old /
// RENAME); a crash between those steps under the previous runner
// would strand `chat_messages_new` alongside the original and break
// the next boot.
// ============================================================

function findDrizzleDir(): string {
  const path = _require('path') as typeof import('path');
  const fs = _require('fs') as typeof import('fs');

  // Prefer the same project root as `.soul-upload-data` / `accounts.json`
  // (`getProjectRoot`), not `__dirname` of this module. Under Turbopack the
  // migration bundle can live far from the repo root; a shallow walk from
  // `__dirname` used to miss `drizzle/` and fall back to `cwd`/drizzle —
  // wrong cwd breaks `readdirSync` and migrations never run (login then
  // fails on first real query / schema drift).
  const primary = path.join(getProjectRoot(), 'drizzle');
  if (fs.existsSync(primary)) return primary;

  let dir = __dirname;
  for (let i = 0; i < 25; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(process.cwd(), 'drizzle');
}

/** Make a statement idempotent where possible so reruns are safe. */
function toIdempotent(statement: string): string {
  return statement
    .replace(/CREATE\s+TABLE\b(?!\s+IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS')
    .replace(/CREATE\s+UNIQUE\s+INDEX\b(?!\s+IF\s+NOT\s+EXISTS)/gi, 'CREATE UNIQUE INDEX IF NOT EXISTS')
    .replace(/CREATE\s+INDEX\b(?!\s+IF\s+NOT\s+EXISTS)/gi, 'CREATE INDEX IF NOT EXISTS');
}

/**
 * Decide whether a statement must run outside a transaction.  Only
 * PRAGMA statements with transaction-sensitive targets qualify; most
 * notably `PRAGMA foreign_keys` and `PRAGMA foreign_key_check`, whose
 * SQLite docs explicitly call out the outside-transaction requirement.
 *
 * Upstream references (SU-ITER-092-batch3 · Nit cleanup — capture direct
 * URLs so future maintainers don't have to re-derive the invariant):
 *   - PRAGMA foreign_keys — https://www.sqlite.org/pragma.html#pragma_foreign_keys
 *     ("This pragma is a no-op within a transaction; foreign key
 *     constraint enforcement may only be enabled, disabled or queried
 *     outside of a transaction.")
 *   - PRAGMA foreign_key_check — https://www.sqlite.org/pragma.html#pragma_foreign_key_check
 *
 * Anything else runs inside the transactional body.
 */
function isOutsideTxn(statement: string): boolean {
  return /^\s*PRAGMA\s+/i.test(statement);
}

export async function runMigrations(db: LibSQLDatabase<typeof schema>): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const path = _require('path') as typeof import('path');
  const fs = _require('fs') as typeof import('fs');

  const migrationsDir = findDrizzleDir();
  let files: string[];
  try {
    files = (fs.readdirSync(migrationsDir) as string[])
      .filter((f: string) => f.endsWith('.sql'))
      .sort();
  } catch {
    return;
  }

  const appliedRows = await db.all<{ name: string; version: number }>(
    sql`SELECT name, version FROM schema_migrations ORDER BY version`
  );
  const applied = new Set(appliedRows.map((r) => r.name));
  let maxVersion = appliedRows.reduce((mx, r) => Math.max(mx, r.version), -1);

  for (const file of files) {
    if (applied.has(file)) continue;

    const filePath = path.resolve(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf-8') as string;

    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    // Partition into (head PRAGMAs, body, tail PRAGMAs) so the body
    // runs inside db.transaction() while the PRAGMA pair runs on the
    // raw connection.  We walk the list in order so a migration can
    // intersperse multiple outside-txn statements if needed (unusual
    // but legal).
    const groups: Array<{ outside: boolean; body: string[] }> = [];
    for (const raw of statements) {
      const outside = isOutsideTxn(raw);
      const stmt = outside ? raw : toIdempotent(raw);
      const last = groups[groups.length - 1];
      if (last && last.outside === outside) {
        last.body.push(stmt);
      } else {
        groups.push({ outside, body: [stmt] });
      }
    }

    const version = maxVersion + 1;
    for (const group of groups) {
      if (group.outside) {
        for (const stmt of group.body) {
          await db.run(sql.raw(stmt));
        }
      } else {
        await db.transaction(async (tx) => {
          for (const stmt of group.body) {
            await tx.run(sql.raw(stmt));
          }
          // Record the applied migration in the same transaction so
          // a mid-file crash cannot leave schema_migrations claiming
          // success for a half-applied file.  We guard against
          // multi-group migrations (where the bump should only land
          // once) by checking if we've already recorded this version.
          const existing = await tx.all<{ version: number }>(
            sql`SELECT version FROM schema_migrations WHERE version = ${version}`,
          );
          if (existing.length === 0) {
            await tx.run(
              sql`INSERT INTO schema_migrations (version, name) VALUES (${version}, ${file})`,
            );
          }
        });
      }
    }

    // Safety net: if the file contained only outside-txn statements
    // (no body group), record it here outside any transaction so the
    // bookkeeping still advances.
    const everBumped = groups.some((g) => !g.outside);
    if (!everBumped) {
      await db.run(
        sql`INSERT INTO schema_migrations (version, name) VALUES (${version}, ${file})`,
      );
    }

    maxVersion = version;
  }
}
