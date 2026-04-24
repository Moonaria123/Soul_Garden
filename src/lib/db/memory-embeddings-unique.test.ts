import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { memoryEmbeddings } from './schema';
import * as schema from './schema';

// ============================================================
// SU-ITER-088 · P0-H · memoryEmbeddings unique constraint tests.
//
// Exercises the post-migration invariant on an in-memory libsql
// database:
//   1. Upsert with the same (memoryId, memoryKind) updates the
//      existing row instead of inserting a duplicate.
//   2. Rows with the same memoryId but different memoryKind remain
//      distinct.
//   3. When a pre-migration database already contains duplicate
//      rows (simulating the worst case), running the migration SQL
//      deduplicates them and creates the unique index without
//      raising.
// ============================================================

interface TestDb {
  client: Client;
  db: LibSQLDatabase<typeof schema>;
}

async function openEmpty(): Promise<TestDb> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  return { client, db };
}

/** Creates the memory_embeddings table in its post-migration shape. */
async function createTablePostMigration(db: LibSQLDatabase<typeof schema>): Promise<void> {
  await db.run(sql`CREATE TABLE memory_embeddings (
    memory_id TEXT NOT NULL,
    memory_kind TEXT NOT NULL,
    embedding BLOB,
    model_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.run(sql`CREATE UNIQUE INDEX uq_memory_embeddings_id_kind ON memory_embeddings (memory_id, memory_kind)`);
}

/** Creates the table in its pre-migration shape (plain index only). */
async function createTablePreMigration(db: LibSQLDatabase<typeof schema>): Promise<void> {
  await db.run(sql`CREATE TABLE memory_embeddings (
    memory_id TEXT NOT NULL,
    memory_kind TEXT NOT NULL,
    embedding BLOB,
    model_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.run(sql`CREATE INDEX idx_memory_embeddings_pk ON memory_embeddings (memory_id, memory_kind)`);
}

/** Runs the exact statements from drizzle/0001_memory_embeddings_unique.sql. */
async function applyMigration0001(db: LibSQLDatabase<typeof schema>): Promise<void> {
  await db.run(sql`DELETE FROM memory_embeddings WHERE rowid NOT IN (SELECT MAX(rowid) FROM memory_embeddings GROUP BY memory_id, memory_kind)`);
  await db.run(sql`DROP INDEX IF EXISTS idx_memory_embeddings_pk`);
  await db.run(sql`CREATE UNIQUE INDEX uq_memory_embeddings_id_kind ON memory_embeddings (memory_id, memory_kind)`);
}

describe('memory_embeddings unique constraint (SU-088 P0-H)', () => {
  let harness: TestDb;

  beforeEach(async () => {
    harness = await openEmpty();
  });

  it('upsert: writing the same (memoryId, memoryKind) twice keeps exactly one row and updates fields', async () => {
    const { db } = harness;
    await createTablePostMigration(db);

    await db
      .insert(memoryEmbeddings)
      .values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'model-a' })
      .onConflictDoUpdate({
        target: [memoryEmbeddings.memoryId, memoryEmbeddings.memoryKind],
        set: { modelName: 'model-a' },
      });

    await db
      .insert(memoryEmbeddings)
      .values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'model-b' })
      .onConflictDoUpdate({
        target: [memoryEmbeddings.memoryId, memoryEmbeddings.memoryKind],
        set: { modelName: 'model-b' },
      });

    const rows = await db.all<{ memory_id: string; memory_kind: string; model_name: string }>(
      sql`SELECT memory_id, memory_kind, model_name FROM memory_embeddings`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].memory_id).toBe('mem-1');
    expect(rows[0].memory_kind).toBe('event');
    expect(rows[0].model_name).toBe('model-b');
  });

  it('keeps two rows when memoryId is shared but memoryKind differs', async () => {
    const { db } = harness;
    await createTablePostMigration(db);

    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'm' });
    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'fact', modelName: 'm' });

    const rows = await db.all<{ memory_kind: string }>(
      sql`SELECT memory_kind FROM memory_embeddings WHERE memory_id = 'mem-1' ORDER BY memory_kind`
    );
    expect(rows.map((r) => r.memory_kind)).toEqual(['event', 'fact']);
  });

  it('rejects a naive duplicate insert once the unique index is in place', async () => {
    const { db } = harness;
    await createTablePostMigration(db);

    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'a' });

    // drizzle wraps the libsql error as "Failed query: insert into ..."; we
    // assert that a plain insert rejects (proving the unique index fired)
    // instead of matching the underlying SQLITE_CONSTRAINT_UNIQUE text.
    await expect(
      db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'b' })
    ).rejects.toThrow();

    const rows = await db.all<{ count: number }>(sql`SELECT COUNT(*) as count FROM memory_embeddings`);
    expect(rows[0].count).toBe(1);
  });

  it('migrates a pre-migration DB with duplicates down to one row per key', async () => {
    const { db } = harness;
    await createTablePreMigration(db);

    // Seed three duplicates for the same key plus one independent row.
    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'v1' });
    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'v2' });
    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-1', memoryKind: 'event', modelName: 'v3' });
    await db.insert(memoryEmbeddings).values({ memoryId: 'mem-2', memoryKind: 'event', modelName: 'other' });

    const before = await db.all<{ count: number }>(sql`SELECT COUNT(*) as count FROM memory_embeddings`);
    expect(before[0].count).toBe(4);

    await applyMigration0001(db);

    const after = await db.all<{ memory_id: string; memory_kind: string; model_name: string }>(
      sql`SELECT memory_id, memory_kind, model_name FROM memory_embeddings ORDER BY memory_id`
    );
    expect(after).toHaveLength(2);
    // Dedupe keeps the row with the highest rowid (last insert wins).
    expect(after[0]).toMatchObject({ memory_id: 'mem-1', model_name: 'v3' });
    expect(after[1]).toMatchObject({ memory_id: 'mem-2', model_name: 'other' });

    // Re-inserting a duplicate after migration must now fail (drizzle
    // wraps libsql's SQLITE_CONSTRAINT_UNIQUE as a generic "Failed query"
    // error; asserting the rejection is enough).
    await expect(
      db.insert(memoryEmbeddings).values({ memoryId: 'mem-2', memoryKind: 'event', modelName: 'dup' })
    ).rejects.toThrow();
  });
});
