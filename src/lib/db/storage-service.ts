import { eq, asc, sql } from 'drizzle-orm';
import { type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

// ============================================================
// StorageService — Server-side CRUD using Drizzle ORM
// All operations take a Drizzle db instance (session-bound).
// ============================================================

type DB = LibSQLDatabase<typeof schema>;

// --- Providers ---

export async function getAllProviders(db: DB) {
  return db.select().from(schema.providers).all();
}

export async function getProvider(db: DB, id: string) {
  const rows = await db.select().from(schema.providers).where(eq(schema.providers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertProvider(db: DB, data: typeof schema.providers.$inferInsert) {
  await db.insert(schema.providers).values(data).onConflictDoUpdate({
    target: schema.providers.id,
    set: { ...data, updatedAt: new Date().toISOString() },
  });
}

export async function deleteProvider(db: DB, id: string) {
  await db.delete(schema.providers).where(eq(schema.providers.id, id));
}

/**
 * SU-ITER-092-batch3 · A3-MEDIUM-02 — single-statement flip of the
 * "default provider" bit.  The previous client-side implementation
 * (`provider-store.setDefaultProvider`) materialised every row, flipped
 * `isDefault` locally, then issued one `upsertProvider` HTTP call per
 * row — classic N-writes where 1 would do.  Besides the wire-level
 * fanout, it opened a window where a concurrent read could observe
 * *two* default rows mid-sweep (or *zero*, depending on ordering).
 *
 * The server-side variant below is a single UPDATE that sets
 * `is_default` to `(id = :target)` across the whole table and bumps
 * `updated_at` in lock-step.  libsql exposes a single SQLite
 * transaction per statement, so the "two defaults" race closes at the
 * storage layer.
 *
 * We intentionally do *not* pre-check that `:target` exists — the
 * statement is idempotent either way (no row matches → every row ends
 * with `is_default = 0`, which downstream hydration treats as "no
 * default configured" and falls back to the first enabled provider).
 * Callers that need "row not found" semantics should read
 * `getProvider` first.
 */
export async function setDefaultProvider(db: DB, id: string) {
  const now = new Date().toISOString();
  await db
    .update(schema.providers)
    .set({
      isDefault: sql`CASE WHEN ${schema.providers.id} = ${id} THEN 1 ELSE 0 END`,
      updatedAt: now,
    });
}

// --- Provider Models ---

export async function getModelsForProvider(db: DB, providerId: string) {
  return db.select().from(schema.providerModels).where(eq(schema.providerModels.providerId, providerId)).all();
}

export async function upsertProviderModel(db: DB, data: typeof schema.providerModels.$inferInsert) {
  await db.insert(schema.providerModels).values(data).onConflictDoUpdate({
    target: schema.providerModels.id,
    set: data,
  });
}

export async function deleteProviderModel(db: DB, id: string) {
  await db.delete(schema.providerModels).where(eq(schema.providerModels.id, id));
}

export async function deleteModelsForProvider(db: DB, providerId: string) {
  await db.delete(schema.providerModels).where(eq(schema.providerModels.providerId, providerId));
}

/**
 * SU-ITER-090c · P2-07 — batch helper that ships every provider with its
 * model list in a single round trip.  Previously `provider-store.loadProviders`
 * issued 1 + N queries (one `listProviders`, one `listModels` per provider
 * — classic N+1, visible whenever a user had more than a couple of
 * configured provider rows).  We now do two bulk selects (providers +
 * every model row) and group the models by providerId in JS.  Note
 * the `Promise.all` is *JS*-concurrent, not truly parallel: libsql
 * serialises statements onto a single connection, so the two selects
 * execute back-to-back rather than simultaneously — but the HTTP
 * round-trip count at the callsite still collapses from 1 + N to 1.
 * The total SQL cost is O(2) regardless of the provider count and
 * the HTTP cost from the browser collapses to a single `POST
 * providers/list-with-models` call.
 *
 * We intentionally do not `LEFT JOIN` because libsql's result type for
 * joined queries would flatten the model rows into the provider row
 * shape and force us to detect `null` joins; the two-select variant is
 * simpler and still optimal.
 */
export async function getAllProvidersWithModels(db: DB) {
  const [providers, models] = await Promise.all([
    db.select().from(schema.providers).all(),
    db.select().from(schema.providerModels).all(),
  ]);

  const modelsByProvider = new Map<string, typeof models>();
  for (const m of models) {
    const bucket = modelsByProvider.get(m.providerId);
    if (bucket) bucket.push(m);
    else modelsByProvider.set(m.providerId, [m]);
  }

  return providers.map((p) => ({
    provider: p,
    models: modelsByProvider.get(p.id) ?? [],
  }));
}

// --- Entities ---

export async function getAllEntities(db: DB) {
  return db.select().from(schema.entities).all();
}

export async function getEntity(db: DB, id: string) {
  const rows = await db.select().from(schema.entities).where(eq(schema.entities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertEntity(db: DB, data: typeof schema.entities.$inferInsert) {
  await db.insert(schema.entities).values(data).onConflictDoUpdate({
    target: schema.entities.id,
    set: { ...data, updatedAt: new Date().toISOString() },
  });
}

export async function deleteEntity(db: DB, id: string) {
  await db.delete(schema.entities).where(eq(schema.entities.id, id));
}

// --- Chat Sessions ---

export async function getSessionsForEntity(db: DB, entityId: string) {
  return db.select().from(schema.chatSessions).where(eq(schema.chatSessions.entityId, entityId)).all();
}

export async function getSession(db: DB, id: string) {
  const rows = await db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertSession(db: DB, data: typeof schema.chatSessions.$inferInsert) {
  await db.insert(schema.chatSessions).values(data).onConflictDoUpdate({
    target: schema.chatSessions.id,
    set: { ...data, updatedAt: new Date().toISOString() },
  });
}

export async function deleteSession(db: DB, id: string) {
  await db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, id));
}

// --- Chat Messages ---

/**
 * SU-ITER-091-batch2 · P3-08 — optional ascending-timestamp pagination.
 *
 * Callers that omit both `limit` and `offset` get the legacy
 * "return every row for this session" behaviour so existing chat
 * hydration code keeps working.  When `limit` is provided the caller
 * opts into a bounded window and may page through history by
 * re-issuing the call with an increasing `offset` (or cursor-based
 * logic layered on top of the resulting rows).  The server route
 * additionally clamps `limit <= 10 000` to keep one overly-eager
 * request from fetching the entire table.
 */
export interface ListMessagesOptions {
  limit?: number;
  offset?: number;
}

export async function getMessagesForSession(
  db: DB,
  sessionId: string,
  options: ListMessagesOptions = {},
) {
  const base = db.select().from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, sessionId))
    .orderBy(asc(schema.chatMessages.timestamp));
  if (typeof options.limit === 'number' && options.limit > 0) {
    const offset = typeof options.offset === 'number' && options.offset >= 0
      ? options.offset
      : 0;
    return base.limit(options.limit).offset(offset).all();
  }
  return base.all();
}

export async function getMessagesForEntity(db: DB, entityId: string) {
  return db.select().from(schema.chatMessages)
    .where(eq(schema.chatMessages.entityId, entityId))
    .orderBy(asc(schema.chatMessages.timestamp))
    .all();
}

/**
 * SU-ITER-091-batch2 · P3-07 — every `onConflictDoNothing` insert now
 * returns the number of rows actually written so callers can surface
 * "skipped duplicates" instead of silently dropping collisions.
 *
 * Drizzle's `.returning()` only yields rows for successful inserts, so
 * the delta between `data.length` and `returning().length` IS the
 * skipped count.  Callers that don't care (the legacy hot path) can
 * ignore the return value without cost.
 */
export interface InsertBatchResult {
  inserted: number;
  skipped: number;
}

export async function insertMessage(
  db: DB,
  data: typeof schema.chatMessages.$inferInsert,
): Promise<InsertBatchResult> {
  const rows = await db.insert(schema.chatMessages)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: schema.chatMessages.id });
  return { inserted: rows.length, skipped: 1 - rows.length };
}

export async function insertMessages(
  db: DB,
  data: (typeof schema.chatMessages.$inferInsert)[],
): Promise<InsertBatchResult> {
  if (data.length === 0) return { inserted: 0, skipped: 0 };
  const rows = await db.insert(schema.chatMessages)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: schema.chatMessages.id });
  return { inserted: rows.length, skipped: data.length - rows.length };
}

export async function deleteMessage(db: DB, id: string) {
  await db.delete(schema.chatMessages).where(eq(schema.chatMessages.id, id));
}

export async function deleteMessagesForSession(db: DB, sessionId: string) {
  await db.delete(schema.chatMessages).where(eq(schema.chatMessages.sessionId, sessionId));
}

// --- User Profiles ---

export async function getUserProfile(db: DB, id: string = 'global-user-profile') {
  const rows = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUserProfile(db: DB, data: typeof schema.userProfiles.$inferInsert) {
  await db.insert(schema.userProfiles).values(data).onConflictDoUpdate({
    target: schema.userProfiles.id,
    set: { ...data, updatedAt: new Date().toISOString() },
  });
}

// --- Drafts ---

export async function getDraft(db: DB, id: string) {
  const rows = await db.select().from(schema.drafts).where(eq(schema.drafts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertDraft(db: DB, data: typeof schema.drafts.$inferInsert) {
  await db.insert(schema.drafts).values(data).onConflictDoUpdate({
    target: schema.drafts.id,
    set: { ...data, updatedAt: new Date().toISOString() },
  });
}

export async function deleteDraft(db: DB, id: string) {
  await db.delete(schema.drafts).where(eq(schema.drafts.id, id));
}

// --- App Config ---

export async function getConfig(db: DB, key: string) {
  const rows = await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, key)).limit(1);
  return rows[0] ?? null;
}

export async function setConfig(db: DB, key: string, value: string) {
  await db.insert(schema.appConfig).values({ key, value }).onConflictDoUpdate({
    target: schema.appConfig.key,
    set: { value, updatedAt: new Date().toISOString() },
  });
}

export async function deleteConfig(db: DB, key: string) {
  await db.delete(schema.appConfig).where(eq(schema.appConfig.key, key));
}

// --- Memory Events ---

export async function getMemoryEventsForEntity(db: DB, entityId: string) {
  return db.select().from(schema.memoryEvents)
    .where(eq(schema.memoryEvents.entityId, entityId))
    .all();
}

export async function insertMemoryEvents(
  db: DB,
  data: (typeof schema.memoryEvents.$inferInsert)[],
): Promise<InsertBatchResult> {
  if (data.length === 0) return { inserted: 0, skipped: 0 };
  const rows = await db.insert(schema.memoryEvents)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: schema.memoryEvents.id });
  return { inserted: rows.length, skipped: data.length - rows.length };
}

export async function deleteMemoryEventsForEntity(db: DB, entityId: string) {
  await db.delete(schema.memoryEvents).where(eq(schema.memoryEvents.entityId, entityId));
}

// --- Memory Facts ---

export async function getMemoryFactsForEntity(db: DB, entityId: string) {
  return db.select().from(schema.memoryFacts)
    .where(eq(schema.memoryFacts.entityId, entityId))
    .all();
}

export async function insertMemoryFacts(
  db: DB,
  data: (typeof schema.memoryFacts.$inferInsert)[],
): Promise<InsertBatchResult> {
  if (data.length === 0) return { inserted: 0, skipped: 0 };
  const rows = await db.insert(schema.memoryFacts)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: schema.memoryFacts.id });
  return { inserted: rows.length, skipped: data.length - rows.length };
}

export async function deleteMemoryFactsForEntity(db: DB, entityId: string) {
  await db.delete(schema.memoryFacts).where(eq(schema.memoryFacts.entityId, entityId));
}

// --- Memory Summaries ---

export async function getMemorySummariesForEntity(db: DB, entityId: string) {
  return db.select().from(schema.memorySummaries)
    .where(eq(schema.memorySummaries.entityId, entityId))
    .all();
}

export async function insertMemorySummaries(
  db: DB,
  data: (typeof schema.memorySummaries.$inferInsert)[],
): Promise<InsertBatchResult> {
  if (data.length === 0) return { inserted: 0, skipped: 0 };
  const rows = await db.insert(schema.memorySummaries)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: schema.memorySummaries.id });
  return { inserted: rows.length, skipped: data.length - rows.length };
}

export async function deleteMemorySummariesForEntity(db: DB, entityId: string) {
  await db.delete(schema.memorySummaries).where(eq(schema.memorySummaries.entityId, entityId));
}

// --- Relationship Snapshots ---

export async function getRelationshipSnapshotForEntity(db: DB, entityId: string) {
  const rows = await db.select().from(schema.relationshipSnapshots)
    .where(eq(schema.relationshipSnapshots.entityId, entityId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertRelationshipSnapshot(db: DB, data: typeof schema.relationshipSnapshots.$inferInsert) {
  await db.insert(schema.relationshipSnapshots).values(data).onConflictDoUpdate({
    target: schema.relationshipSnapshots.id,
    set: { ...data, updatedAt: new Date().toISOString() },
  });
}

export async function deleteRelationshipSnapshotForEntity(db: DB, entityId: string) {
  await db.delete(schema.relationshipSnapshots).where(eq(schema.relationshipSnapshots.entityId, entityId));
}

// --- Open Loops ---

export async function getOpenLoopsForEntity(db: DB, entityId: string) {
  return db.select().from(schema.openLoops)
    .where(eq(schema.openLoops.entityId, entityId))
    .all();
}

export async function insertOpenLoops(
  db: DB,
  data: (typeof schema.openLoops.$inferInsert)[],
): Promise<InsertBatchResult> {
  if (data.length === 0) return { inserted: 0, skipped: 0 };
  const rows = await db.insert(schema.openLoops)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: schema.openLoops.id });
  return { inserted: rows.length, skipped: data.length - rows.length };
}

export async function deleteOpenLoopsForEntity(db: DB, entityId: string) {
  await db.delete(schema.openLoops).where(eq(schema.openLoops.entityId, entityId));
}
