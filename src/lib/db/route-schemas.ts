import { z } from 'zod';
import { AtomicEntityRestorePayloadSchema } from './restore-atomic';

// ============================================================
// SU-ITER-091-batch2 · code-C-4 + sec-C-A + sec-C-B + code-C-2
//
// Zod schemas for every body payload accepted by `POST /api/db/*`.
// Before this consolidation each single-object upsert (`providers/
// upsert`, `entities/upsert`, etc.) relied on an `as Parameters<typeof
// storage.X>[1]` cast at the route boundary, and each memory batch
// insert (`memory/events/insert-batch`, …) accepted anything that
// passed an `Array.isArray()` check — both paths let callers smuggle
// smuggled columns into the SQL layer.  The schemas below shift
// validation to happen *before* Drizzle sees the payload.
//
// Design notes:
// - Leaf rows use `.passthrough()` so new columns added to the Drizzle
//   schema land without breaking round-trip backups (the backup
//   serializer writes raw `$inferSelect` rows and those carry every
//   column).  Forward-compat is the explicit intent.
// - Top-level bodies use `.strict()` so clients can't smuggle stray
//   keys alongside the array/object they want to send.
// - Array payloads carry `.max(cap)` to match
//   `restore-atomic::ARRAY_CAPS`; both places derive from the same
//   `MAX_*` constants so a backup that passes the entity-restore
//   schema can also pass the per-batch insert schema.
// - `role` fields narrow to a closed enum (see P3-05 and the chat
//   message row schema below); malformed roles are rejected early.
//
// Error responses are produced via `zodErrorResponse()` in
// `route-helpers.ts` so every failure path returns the same shape
// (`{ error: 'invalid_body', fields: string[] }`).
// ============================================================

// --- Shared primitives ---

const Id = z.string().min(1).max(256);
const ShortText = z.string().max(1_000);
const LongText = z.string().max(1_000_000);
const Timestamp = z.string().min(1).max(64); // ISO 8601 strings; permissive so existing fixtures stay legal.
// SU-ITER-091-batch2 · follow-up — drizzle's $inferInsert narrows
// defaulted `.notNull().default(now)` columns to `string | undefined`
// (no null).  Legacy clients/backups still occasionally serialize
// these timestamps as `null`, so we accept both shapes on input but
// transform `null` → `undefined` so the parsed value is assignable
// to the storage-service parameter type without the previous
// `as Parameters<typeof storage.X>[1]` smuggle cast.  Columns that
// are genuinely nullable at the SQL level (e.g.
// `lastMeaningfulContactAt`) keep their nullable $inferInsert shape
// because we just drop the `null` on the way in — drizzle omits
// undefined fields, which then writes `NULL` for nullable columns
// and falls back to the `default(now)` expression for defaulted
// columns.  Same observable behaviour either way.
const OptionalTimestamp = z
  .string()
  .max(64)
  .nullish()
  .transform((v) => (v ?? undefined) as string | undefined);

/**
 * A leaf row belonging to one of the Drizzle tables we expose via
 * backup/restore.  We enforce the primary-key field (`id`) and let
 * every other column through — Drizzle is the source of truth for
 * column-level validation (e.g. `NOT NULL`, type coercion), so a
 * duplicate layer here would only double-maintain the schema.
 */
const LeafRowWithId = z.object({ id: Id }).passthrough();

// --- Message role (P3-05) ---
//
// The LLM chat route already narrows roles to the enum below via
// `ChatMessageSchema`, but the DB insert path also accepted `system`
// implicitly and crashed on anything else inside Drizzle.  Making the
// enum explicit here produces a clean 400 with `{ error:
// 'invalid_body', fields: ['role'] }` instead of a 500.
export const ChatRoleEnum = z.enum(['user', 'assistant', 'system']);

// --- Single-object upserts (sec-C-B + code-C-2) ---

/**
 * Provider upsert.  The `encryptedApiKey` / `apiKeyIV` pair is
 * optional because a provider row is allowed to exist without an API
 * key (e.g. the user is mid-setup).  Server-side encryption happens
 * in the crypto module — the HTTP surface only sees the ciphertext.
 */
export const ProviderUpsertBody = z
  .object({
    id: Id,
    name: ShortText,
    apiType: ShortText.optional(),
    baseUrl: ShortText,
    encryptedApiKey: z.string().max(10_000).nullable().optional(),
    apiKeyIV: z.string().max(256).nullable().optional(),
    isDefault: z.boolean().optional(),
    enabled: z.boolean().optional(),
    createdAt: OptionalTimestamp,
    updatedAt: OptionalTimestamp,
  })
  .strict();

// SU-ITER-092-batch3 · A3-MEDIUM-02 — body schema for the single-statement
// "flip default provider" route.  See storage-service.setDefaultProvider for
// the transactional reasoning.
export const SetDefaultProviderBody = z.object({ id: Id }).strict();

export const ProviderModelUpsertBody = z
  .object({
    id: Id,
    providerId: Id,
    name: ShortText,
    displayName: ShortText.nullable().optional(),
    alias: ShortText.nullable().optional(),
    contextWindow: z.number().int().nonnegative().nullable().optional(),
    isCustom: z.boolean().optional(),
    enabled: z.boolean().optional(),
    supportsThinking: z.boolean().optional(),
    supportsVision: z.boolean().optional(),
    supportsWebSearch: z.boolean().optional(),
    capabilitiesText: z.boolean().optional(),
    createdAt: OptionalTimestamp,
  })
  .strict();

export const EntityUpsertBody = z
  .object({
    id: Id,
    name: ShortText,
    entityType: ShortText,
    status: ShortText.optional(),
    avatarData: z.string().max(5_000_000).nullable().optional(), // base64 up to ~3.5 MB decoded
    questionnaireData: LongText.nullable().optional(),
    soulDocs: LongText.nullable().optional(),
    textMaterials: LongText.nullable().optional(),
    chatMaterials: LongText.nullable().optional(),
    webSearchMaterials: LongText.nullable().optional(),
    backgroundImage: z.string().max(5_000_000).nullable().optional(),
    userCallName: ShortText.nullable().optional(),
    userPerception: LongText.nullable().optional(),
    nickname: ShortText.nullable().optional(),
    region: ShortText.nullable().optional(),
    errorMessage: LongText.nullable().optional(),
    createdAt: OptionalTimestamp,
    updatedAt: OptionalTimestamp,
  })
  .strict();

export const SessionUpsertBody = z
  .object({
    id: Id,
    entityId: Id,
    title: ShortText.optional(),
    summaries: LongText.nullable().optional(),
    lastSummarizedMessageIndex: z.number().int().nonnegative().nullable().optional(),
    status: ShortText.optional(),
    createdAt: OptionalTimestamp,
    updatedAt: OptionalTimestamp,
  })
  .strict();

export const MessageInsertBody = z
  .object({
    id: Id,
    sessionId: Id,
    entityId: Id,
    role: ChatRoleEnum,
    content: LongText,
    timestamp: Timestamp,
    tokenEstimate: z.number().int().nonnegative().nullable().optional(),
    emotionHint: ShortText.nullable().optional(),
    createdAt: OptionalTimestamp,
  })
  .strict();

export const UserProfileUpsertBody = z
  .object({
    id: Id.optional(),
    displayName: ShortText.nullable().optional(),
    nickname: ShortText.nullable().optional(),
    // SU-ITER-091-batch2 · P3-11 — age stays a free-form text column
    // by design (see schema.ts comment for the UX rationale: users may
    // enter "25", "90后", "twenties", "prefer not to say", …).  We
    // still need to bound the surface area:
    //   * `max(64)` blocks the "text affinity" DoS vector the P3-11
    //     reviewer was worried about.
    //   * the control-character filter (\x00-\x1F \x7F) blocks
    //     homograph / terminal-escape mischief without blocking CJK
    //     characters.
    // If we later introduce an age-bucket feature it belongs in a new
    // column, not this one.
    age: z
      .string()
      .max(64, 'age must be ≤ 64 chars')
      .regex(/^[^\x00-\x1F\x7F]*$/, 'age must not contain control chars')
      .nullable()
      .optional(),
    gender: ShortText.nullable().optional(),
    personality: LongText.nullable().optional(),
    bio: LongText.nullable().optional(),
    avatarData: z.string().max(5_000_000).nullable().optional(),
    chatReplyStyle: LongText.nullable().optional(),
    createdAt: OptionalTimestamp,
    updatedAt: OptionalTimestamp,
  })
  .strict();

export const DraftUpsertBody = z
  .object({
    id: Id,
    data: LongText,
    updatedAt: OptionalTimestamp,
  })
  .strict();

export const RelationshipSnapshotUpsertBody = z
  .object({
    id: Id,
    entityId: Id,
    affinityScore: z.number().nullable().optional(),
    trustScore: z.number().nullable().optional(),
    emotionalTemperature: z.number().nullable().optional(),
    boundarySensitivity: z.number().nullable().optional(),
    preferredAddressingStyle: ShortText.nullable().optional(),
    lastMeaningfulContactAt: OptionalTimestamp,
    updatedAt: OptionalTimestamp,
  })
  .strict();

// --- Memory batch payloads (sec-C-A) ---
//
// Element-level validation uses `LeafRowWithId` — full column-level
// validation would double-maintain Drizzle's typed `$inferInsert`, so
// we focus on the invariants the SQL layer can't enforce on its own
// (row objects must carry an `id`, and the wrapper must be an array
// with a known cap).
//
// The caps here mirror `restore-atomic::ARRAY_CAPS` minus a factor
// of 10 on the largest (`chatMessages`) — a single `insert-batch`
// call isn't expected to carry the full entity load (that goes
// through `memory/restore-entity-atomic`), so the tighter limit
// exposes runaway frontend loops early.
const MAX_EVENTS_PER_CALL = 100_000;
const MAX_FACTS_PER_CALL = 10_000;
const MAX_SUMMARIES_PER_CALL = 10_000;
const MAX_OPEN_LOOPS_PER_CALL = 10_000;
const MAX_MESSAGES_PER_CALL = 100_000;

export const MessageBatchBody = z
  .object({
    messages: z.array(LeafRowWithId).max(MAX_MESSAGES_PER_CALL),
  })
  .strict();

export const MemoryEventsBatchBody = z
  .object({
    events: z.array(LeafRowWithId).max(MAX_EVENTS_PER_CALL),
  })
  .strict();

export const MemoryFactsBatchBody = z
  .object({
    facts: z.array(LeafRowWithId).max(MAX_FACTS_PER_CALL),
  })
  .strict();

export const MemorySummariesBatchBody = z
  .object({
    summaries: z.array(LeafRowWithId).max(MAX_SUMMARIES_PER_CALL),
  })
  .strict();

export const OpenLoopsBatchBody = z
  .object({
    loops: z.array(LeafRowWithId).max(MAX_OPEN_LOOPS_PER_CALL),
  })
  .strict();

// --- Config set (already existed in route.ts; re-exported here) ---

export const ConfigSetBody = z
  .object({
    key: z.string().min(1).max(256),
    value: z.string().max(1_000_000),
  })
  .strict();

// --- Atomic entity restore (re-export for the dispatch table) ---

export const RestoreEntityBody = z
  .object({
    payload: AtomicEntityRestorePayloadSchema,
    strategy: z.enum(['create-new', 'replace-existing']),
  })
  .strict();

// --- Backup / V1-compat legacy DEK derivation ---
//
// SU-ITER-091-batch3 — `backup/derive-legacy-dek` accepts the same
// `{ userId, password }` shape as `session/open` / `migration/v1-to-
// v2`.  Keeping the schema strict blocks callers from smuggling extra
// fields (e.g. a fake `saltHex`) into an endpoint that will then run
// a PBKDF2 × 600_000 round.  `userId` mirrors the StoredAccount id
// format (uuid v4, ≤ 64 chars); `password` is bounded at 256 chars
// to match the account-create flow.
export const BackupDeriveLegacyDekBody = z
  .object({
    userId: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

// Public caps export so tests can assert the documented upper bound.
export const BATCH_CAPS = {
  events: MAX_EVENTS_PER_CALL,
  facts: MAX_FACTS_PER_CALL,
  summaries: MAX_SUMMARIES_PER_CALL,
  openLoops: MAX_OPEN_LOOPS_PER_CALL,
  messages: MAX_MESSAGES_PER_CALL,
} as const;
