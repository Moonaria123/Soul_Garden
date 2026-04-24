import { eq } from 'drizzle-orm';
import { type LibSQLDatabase } from 'drizzle-orm/libsql';
import { z } from 'zod';
import * as schema from './schema';

// ============================================================
// SU-088 · P0-E: atomic entity restore.
//
// `backup-restore.ts`'s `restoreEntityPayload` used to drop the
// existing entity and then re-insert rows across seven tables via
// multiple HTTP round-trips.  Any failure mid-flight left the user
// with partial data.  This helper consolidates the delete + insert
// pipeline into a single libsql transaction so a thrown error
// rolls back every change atomically.
// ============================================================

export type EntityRestoreStrategy = 'create-new' | 'replace-existing';

/** Payload shape used by both client call-sites and the atomic tx. */
export interface AtomicEntityRestorePayload {
  entity: typeof schema.entities.$inferInsert;
  chat: {
    sessions: (typeof schema.chatSessions.$inferInsert)[];
    messages: (typeof schema.chatMessages.$inferInsert)[];
  };
  memory: {
    events: (typeof schema.memoryEvents.$inferInsert)[];
    facts: (typeof schema.memoryFacts.$inferInsert)[];
    summaries: (typeof schema.memorySummaries.$inferInsert)[];
    relationshipSnapshots: (typeof schema.relationshipSnapshots.$inferInsert)[];
    openLoops: (typeof schema.openLoops.$inferInsert)[];
  };
}

// ============================================================
// SU-ITER-091-batch1 · sec-C-C —
// Outer-envelope Zod validator for `memory/restore-entity-atomic`.
//
// The previous `RestoreEntityBody = z.object({ payload: z.object({}).passthrough() })`
// gate checked only that `payload` was *some* object; every nested
// structure landed inside `runAtomicEntityRestore` as `object` and the
// route cast it with `as unknown as Parameters<...>[1]` to compile.
// That left three latent failure modes:
//
//   1. A malformed backup (e.g. `chat.messages` coerced to `null`)
//      would crash mid-transaction — after the delete branch ran in
//      `replace-existing` mode — instead of 400ing up-front.
//   2. A hostile caller could smuggle extra top-level keys that flow
//      through `Drizzle.values(...)` as column writes; Drizzle ignores
//      unknowns on insert, but relying on that was an implicit trust.
//   3. Unbounded arrays opened a trivial DoS: a 10M-element
//      `messages` array would tie up the libsql transaction long past
//      the 10 s db-client timeout.
//
// The schema below:
//   - `.strict()` at every structural level to reject smuggled keys.
//   - Leaf row entries are `{ id: string }.passthrough()` so schema
//     additions (e.g. a new optional column in `entities`) flow
//     through without a backend redeploy.
//   - Array caps chosen 10× above the largest observed single-entity
//     backup (messages ≈ 1M keeps multi-year chat users covered while
//     bounding the worst-case transaction to ~tens of MiB).
//   - `entity.id/name/entityType` are required because every op in
//     `planEntityRestoreOps` dereferences them.
// ============================================================

/**
 * ID constraint for any row inside the restore payload.  Matches the
 * UUID re-map path in `backup-restore.ts::remapEntityIds` (which
 * assumes `.id` is a non-empty string it can substitute).  Upper
 * bound of 256 matches Drizzle's `text()` column usage and leaves
 * room for future namespaced IDs.
 */
const RowIdField = z.string().min(1).max(256);

/**
 * Every row carries at minimum `.id`; other columns flow through
 * `.passthrough()` so Drizzle's `$inferInsert` stays the source of
 * truth for column-level shape (which we already enforce via the
 * TypeScript interface above).  Belt-and-suspenders validation at the
 * column layer is tracked as P3 — we do NOT want to double-maintain
 * Drizzle's schema.ts *and* a Zod mirror in two places.
 */
const RestoreRowSchema = z.object({ id: RowIdField }).passthrough();

/** Hard caps protect the restore transaction from runaway payloads. */
const ARRAY_CAPS = {
  sessions: 100_000,
  messages: 1_000_000,
  events: 1_000_000,
  facts: 100_000,
  summaries: 100_000,
  relationshipSnapshots: 10_000,
  openLoops: 100_000,
} as const;

// SU-ITER-092-batch1 · Nit-3 — asymmetry is deliberate.  `entity` is a
// row-level object whose Drizzle `$inferInsert` type keeps evolving
// (soulDocs, chatBackgroundImage, ...), so the outer wrapper accepts
// new top-level properties via `.passthrough()`; `RowIdField` + `name` +
// `entityType` are the only invariants restore needs to dispatch on.
//
// `chat` and `memory` by contrast are fixed **container** shapes — they
// only ever carry named row arrays.  Any extra key at the container
// level means a client is trying to smuggle unexpected rowsets into the
// transaction and must be rejected — hence `.strict()`.  Row bodies
// inside those arrays remain `RowIdField + .passthrough()` for the same
// forward-compat reason as `entity`.
export const AtomicEntityRestorePayloadSchema = z
  .object({
    entity: z
      .object({
        id: RowIdField,
        name: z.string().min(1).max(1_024),
        entityType: z.string().min(1).max(64),
      })
      .passthrough(),
    chat: z
      .object({
        sessions: z.array(RestoreRowSchema).max(ARRAY_CAPS.sessions),
        messages: z.array(RestoreRowSchema).max(ARRAY_CAPS.messages),
      })
      .strict(),
    memory: z
      .object({
        events: z.array(RestoreRowSchema).max(ARRAY_CAPS.events),
        facts: z.array(RestoreRowSchema).max(ARRAY_CAPS.facts),
        summaries: z.array(RestoreRowSchema).max(ARRAY_CAPS.summaries),
        relationshipSnapshots: z
          .array(RestoreRowSchema)
          .max(ARRAY_CAPS.relationshipSnapshots),
        openLoops: z.array(RestoreRowSchema).max(ARRAY_CAPS.openLoops),
      })
      .strict(),
  })
  .strict();

/**
 * Type inferred from the Zod schema.  NOT the same as
 * `AtomicEntityRestorePayload` — the schema keeps row shapes loose
 * (`.passthrough()` on a `{ id }` base), while the interface above
 * carries the full Drizzle `$inferInsert` shape.  The route narrows
 * with the schema first, then safely casts to the interface when
 * handing off to `runAtomicEntityRestore`.
 */
export type ValidatedAtomicEntityRestorePayload = z.infer<
  typeof AtomicEntityRestorePayloadSchema
>;

/**
 * Describes a restore operation in order.  Exposed primarily for
 * testing; production callers use `runAtomicEntityRestore`.
 */
export type RestoreOp =
  | { kind: 'delete-openLoops'; entityId: string }
  | { kind: 'delete-memorySummaries'; entityId: string }
  | { kind: 'delete-memoryFacts'; entityId: string }
  | { kind: 'delete-memoryEvents'; entityId: string }
  | { kind: 'delete-relationshipSnapshots'; entityId: string }
  | { kind: 'delete-chatMessages'; entityId: string }
  | { kind: 'delete-chatSessions'; entityId: string }
  | { kind: 'delete-entity'; entityId: string }
  | { kind: 'upsert-entity'; row: typeof schema.entities.$inferInsert }
  | { kind: 'insert-chatSessions'; rows: (typeof schema.chatSessions.$inferInsert)[] }
  | { kind: 'insert-chatMessages'; rows: (typeof schema.chatMessages.$inferInsert)[] }
  | { kind: 'insert-memoryEvents'; rows: (typeof schema.memoryEvents.$inferInsert)[] }
  | { kind: 'insert-memoryFacts'; rows: (typeof schema.memoryFacts.$inferInsert)[] }
  | { kind: 'insert-memorySummaries'; rows: (typeof schema.memorySummaries.$inferInsert)[] }
  | { kind: 'upsert-relationshipSnapshot'; row: typeof schema.relationshipSnapshots.$inferInsert }
  | { kind: 'insert-openLoops'; rows: (typeof schema.openLoops.$inferInsert)[] };

/**
 * Build the ordered list of operations for a given payload.  Pure
 * function — no I/O, no side effects — so unit tests can verify the
 * plan without touching SQLite.
 */
export function planEntityRestoreOps(
  payload: AtomicEntityRestorePayload,
  strategy: EntityRestoreStrategy,
): RestoreOp[] {
  const ops: RestoreOp[] = [];
  const entityId = payload.entity.id;

  if (strategy === 'replace-existing') {
    // Child rows first, then parent.  Order matters because of FK
    // references and because a partial delete is the main failure
    // mode we're guarding against.
    ops.push({ kind: 'delete-openLoops', entityId });
    ops.push({ kind: 'delete-memorySummaries', entityId });
    ops.push({ kind: 'delete-memoryFacts', entityId });
    ops.push({ kind: 'delete-memoryEvents', entityId });
    ops.push({ kind: 'delete-relationshipSnapshots', entityId });
    ops.push({ kind: 'delete-chatMessages', entityId });
    ops.push({ kind: 'delete-chatSessions', entityId });
    ops.push({ kind: 'delete-entity', entityId });
  }

  ops.push({ kind: 'upsert-entity', row: payload.entity });

  if (payload.chat.sessions.length > 0) {
    ops.push({ kind: 'insert-chatSessions', rows: payload.chat.sessions });
  }
  if (payload.chat.messages.length > 0) {
    ops.push({ kind: 'insert-chatMessages', rows: payload.chat.messages });
  }
  if (payload.memory.events.length > 0) {
    ops.push({ kind: 'insert-memoryEvents', rows: payload.memory.events });
  }
  if (payload.memory.facts.length > 0) {
    ops.push({ kind: 'insert-memoryFacts', rows: payload.memory.facts });
  }
  if (payload.memory.summaries.length > 0) {
    ops.push({ kind: 'insert-memorySummaries', rows: payload.memory.summaries });
  }
  for (const snap of payload.memory.relationshipSnapshots) {
    ops.push({ kind: 'upsert-relationshipSnapshot', row: snap });
  }
  if (payload.memory.openLoops.length > 0) {
    ops.push({ kind: 'insert-openLoops', rows: payload.memory.openLoops });
  }

  return ops;
}

/** Minimal shape of a drizzle tx handle — the subset we actually use. */
export interface AtomicTxHandle {
  delete: LibSQLDatabase<typeof schema>['delete'];
  insert: LibSQLDatabase<typeof schema>['insert'];
}

/**
 * Execute a planned op list inside an already-open transaction handle.
 * This is what `runAtomicEntityRestore` calls under `db.transaction`.
 */
export async function applyRestoreOps(
  tx: AtomicTxHandle,
  ops: readonly RestoreOp[],
): Promise<void> {
  for (const op of ops) {
    switch (op.kind) {
      case 'delete-openLoops':
        await tx.delete(schema.openLoops).where(eq(schema.openLoops.entityId, op.entityId));
        break;
      case 'delete-memorySummaries':
        await tx.delete(schema.memorySummaries).where(eq(schema.memorySummaries.entityId, op.entityId));
        break;
      case 'delete-memoryFacts':
        await tx.delete(schema.memoryFacts).where(eq(schema.memoryFacts.entityId, op.entityId));
        break;
      case 'delete-memoryEvents':
        await tx.delete(schema.memoryEvents).where(eq(schema.memoryEvents.entityId, op.entityId));
        break;
      case 'delete-relationshipSnapshots':
        await tx.delete(schema.relationshipSnapshots).where(eq(schema.relationshipSnapshots.entityId, op.entityId));
        break;
      case 'delete-chatMessages':
        await tx.delete(schema.chatMessages).where(eq(schema.chatMessages.entityId, op.entityId));
        break;
      case 'delete-chatSessions':
        await tx.delete(schema.chatSessions).where(eq(schema.chatSessions.entityId, op.entityId));
        break;
      case 'delete-entity':
        await tx.delete(schema.entities).where(eq(schema.entities.id, op.entityId));
        break;
      case 'upsert-entity':
        await tx.insert(schema.entities).values(op.row).onConflictDoUpdate({
          target: schema.entities.id,
          set: { ...op.row, updatedAt: new Date().toISOString() },
        });
        break;
      case 'insert-chatSessions':
        await tx.insert(schema.chatSessions).values(op.rows).onConflictDoNothing();
        break;
      case 'insert-chatMessages':
        await tx.insert(schema.chatMessages).values(op.rows).onConflictDoNothing();
        break;
      case 'insert-memoryEvents':
        await tx.insert(schema.memoryEvents).values(op.rows).onConflictDoNothing();
        break;
      case 'insert-memoryFacts':
        await tx.insert(schema.memoryFacts).values(op.rows).onConflictDoNothing();
        break;
      case 'insert-memorySummaries':
        await tx.insert(schema.memorySummaries).values(op.rows).onConflictDoNothing();
        break;
      case 'upsert-relationshipSnapshot':
        await tx.insert(schema.relationshipSnapshots).values(op.row).onConflictDoUpdate({
          target: schema.relationshipSnapshots.id,
          set: { ...op.row, updatedAt: new Date().toISOString() },
        });
        break;
      case 'insert-openLoops':
        await tx.insert(schema.openLoops).values(op.rows).onConflictDoNothing();
        break;
      default: {
        // Exhaustive switch guard — surfaces future op kinds at type check.
        const _exhaustive: never = op;
        throw new Error(`Unknown restore op: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

/**
 * Top-level entry: opens a libsql transaction and executes the plan.
 * Any thrown error rolls the transaction back, guaranteeing the DB
 * observer sees either the full pre-restore state or the full
 * post-restore state — never a half-applied mix.
 */
export async function runAtomicEntityRestore(
  db: LibSQLDatabase<typeof schema>,
  payload: AtomicEntityRestorePayload,
  strategy: EntityRestoreStrategy,
): Promise<void> {
  const ops = planEntityRestoreOps(payload, strategy);
  await db.transaction(async (tx) => {
    // SU-ITER-092-batch3 · Nit cleanup — Drizzle's `tx` is a
    // `SQLiteTransaction<typeof schema, ...>`; its `delete` / `insert`
    // methods have narrower internal generic parameters than
    // `LibSQLDatabase<typeof schema>` even though the runtime shape is
    // identical for the two methods we call.  `AtomicTxHandle` pins
    // exactly that subset so test mocks can implement it without
    // pulling in the full drizzle generics; the double-step cast
    // (`unknown` → `AtomicTxHandle`) is required because TS cannot
    // structurally reconcile the two generic positions on its own.
    // If/when drizzle narrows its transaction type, this cast can drop.
    await applyRestoreOps(tx as unknown as AtomicTxHandle, ops);
  });
}
