// SU-ITER-090b · code-N-4 — migration-v2 split · shared row copier.
//
// Both `runV1ToV2Migration` (v1→v2 re-seal) and `runChangePassword`
// (v2→v2 rekey) perform the same table-by-table dump-and-restore.
// This module owns the single source of truth for that copy loop so
// the two callers can't drift on semantics (bind shapes, transaction
// boundaries, table whitelist).

import type { Client } from '@libsql/client';

export interface CopyContext {
  srcClient: Client;
  dstClient: Client;
}

/**
 * Copy one table from src to dst using `SELECT *` + parameterised inserts.
 * Table names come from `MIGRATION_TABLES` (compile-time whitelist), so
 * the identifier interpolation below is not a SQL-injection vector — we
 * never accept table names from user input.
 *
 * We drop down to the libsql client's native `execute` rather than going
 * through drizzle so we can bind row values as positional args without
 * having to fake a drizzle `sql` template for every combination of columns.
 * Blob columns (e.g. `memory_embeddings.embedding`) arrive as Uint8Array
 * and round-trip as BLOB automatically.
 */
export async function copyTable(
  { srcClient, dstClient }: CopyContext,
  tableName: string,
): Promise<number> {
  const selectResult = await srcClient.execute(
    `SELECT * FROM "${tableName}"`,
  );
  if (selectResult.rows.length === 0) return 0;

  const columns = selectResult.columns;
  const quotedCols = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders})`;

  // libsql auto-commits per statement; single-user datasets are small
  // enough that wrapping a larger transaction is not worth the risk of
  // holding a write lock across a long loop.
  for (const row of selectResult.rows) {
    // `row` is an array-like keyed by column index.  libsql returns
    // values in the shape Drizzle itself would bind back, so we can
    // forward them directly.
    const args = columns.map((c) => row[c] as never);
    await dstClient.execute({ sql: insertSql, args });
  }

  return selectResult.rows.length;
}
