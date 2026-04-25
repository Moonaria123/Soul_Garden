import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { getSessionState, upsertSessionState } from './storage-service';

describe('session_state upsert merge (SU-044)', () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    db = drizzle(client, { schema });
    await db.run(sql`CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summaries TEXT DEFAULT '[]',
      last_summarized_message_index INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.run(sql`CREATE TABLE session_state (
      session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
      working_summary TEXT,
      last_summarized_message_id TEXT,
      last_memory_extracted_at TEXT,
      status TEXT NOT NULL DEFAULT 'active')
    `);
    await db.insert(schema.chatSessions).values({
      id: 'sess-1',
      entityId: 'ent-1',
      title: 't',
      summaries: '[]',
      lastSummarizedMessageIndex: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('preserves workingSummary when follow-up upsert only sets lastMemoryExtractedAt', async () => {
    await upsertSessionState(db, {
      sessionId: 'sess-1',
      workingSummary: 'hello summary',
      lastSummarizedMessageId: 'm-9',
      lastMemoryExtractedAt: null,
      status: 'active',
    });
    await upsertSessionState(db, {
      sessionId: 'sess-1',
      lastMemoryExtractedAt: '2026-01-01T00:00:00.000Z',
    } as typeof schema.sessionState.$inferInsert);
    const row = await getSessionState(db, 'sess-1');
    expect(row?.workingSummary).toBe('hello summary');
    expect(row?.lastSummarizedMessageId).toBe('m-9');
    expect(row?.lastMemoryExtractedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
