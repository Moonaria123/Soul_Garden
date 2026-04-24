import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Soul Upload — Drizzle ORM Schema
// Covers current V1.x data + pre-created V3.0 memory tables
// ============================================================

const now = sql`(datetime('now'))`;

// --- Provider and model configuration ---

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  apiType: text('api_type').notNull().default('openai'),
  baseUrl: text('base_url').notNull(),
  encryptedApiKey: text('encrypted_api_key'),
  apiKeyIV: text('api_key_iv'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const providerModels = sqliteTable('provider_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  displayName: text('display_name'),
  alias: text('alias'),
  contextWindow: integer('context_window'),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  supportsThinking: integer('supports_thinking', { mode: 'boolean' }).notNull().default(false),
  supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),
  supportsWebSearch: integer('supports_web_search', { mode: 'boolean' }).notNull().default(false),
  capabilitiesText: integer('capabilities_text', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
}, (table) => [
  index('idx_provider_models_provider').on(table.providerId),
]);

// --- Consciousness entities ---

export const entities = sqliteTable('entities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull(),
  // SU-ITER-091-batch2 · P3-12 — DB-level CHECK constraint enforced by
  // drizzle/0003_entities_status_check.sql (table rebuild via the
  // sqlite 12-step pattern).  TS-level narrowing still comes from
  // `EntityStatus` in src/types/index.ts; this comment exists so future
  // readers know why drizzle-kit should never regenerate this column
  // without re-emitting the CHECK via a follow-up migration.
  status: text('status').notNull().default('draft'),
  avatarData: text('avatar_data'),
  questionnaireData: text('questionnaire_data'),
  soulDocs: text('soul_docs'),
  textMaterials: text('text_materials'),
  chatMaterials: text('chat_materials'),
  webSearchMaterials: text('web_search_materials'),
  backgroundImage: text('background_image'),
  userCallName: text('user_call_name'),
  userPerception: text('user_perception'),
  nickname: text('nickname'),
  region: text('region'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

// --- Chat sessions and messages ---

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  summaries: text('summaries').default('[]'),
  lastSummarizedMessageIndex: integer('last_summarized_message_index').default(0),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
}, (table) => [
  index('idx_chat_sessions_entity').on(table.entityId),
]);

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  // SU-ITER-090b · P2-11 — entityId FK added (was unconstrained).  Migration
  // drizzle/0002_chat_messages_entity_fk.sql rebuilds the table via the
  // sqlite 12-step pattern so existing rows pick up the constraint without
  // data loss, dedupes orphans, and preserves the three indexes below.
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  timestamp: text('timestamp').notNull(),
  tokenEstimate: integer('token_estimate'),
  emotionHint: text('emotion_hint'),
  createdAt: text('created_at').notNull().default(now),
}, (table) => [
  index('idx_chat_messages_session').on(table.sessionId),
  index('idx_chat_messages_entity').on(table.entityId),
  index('idx_chat_messages_timestamp').on(table.entityId, table.timestamp),
]);

// --- User profile ---

export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey().default('global-user-profile'),
  displayName: text('display_name'),
  nickname: text('nickname'),
  // SU-ITER-091-batch2 · P3-11 — reviewer flagged `age` as
  // suspiciously `text` in 0000_exotic_mandrill.sql.  After reviewing
  // the UX (`me.agePlaceholder` = "e.g. 25、90 后、不想说…" / "e.g. 25,
  // twenties, prefer not to say…") the free-form shape is intentional:
  // users may enter a decade ("90后"), a life stage ("中年"), a
  // privacy opt-out ("prefer not to say"), or an integer.  Converting
  // to `integer` would force data loss on existing non-numeric rows
  // and break the privacy opt-out.  Wont-fix-by-design: column stays
  // text, the Zod schema in route-schemas.ts enforces a 64-char ceiling
  // + control-character filter so the "text" affinity doesn't become
  // a DoS surface.  If we later ship an "age bucket" feature we can
  // add a sibling `age_bucket INTEGER` column instead of rewriting
  // this one.
  age: text('age'),
  gender: text('gender'),
  personality: text('personality'),
  bio: text('bio'),
  avatarData: text('avatar_data'),
  chatReplyStyle: text('chat_reply_style'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

// --- Drafts and configuration ---

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

// ============================================================
// Memory System Tables (V3.0 — pre-created, empty until SU-ITER-044)
// ============================================================

export const sessionState = sqliteTable('session_state', {
  sessionId: text('session_id').primaryKey().references(() => chatSessions.id, { onDelete: 'cascade' }),
  workingSummary: text('working_summary'),
  lastSummarizedMessageId: text('last_summarized_message_id'),
  lastMemoryExtractedAt: text('last_memory_extracted_at'),
  status: text('status').notNull().default('active'),
});

export const memoryEvents = sqliteTable('memory_events', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => chatSessions.id),
  source: text('source').notNull().default('dialogue'),
  eventType: text('event_type').notNull(),
  summary: text('summary').notNull(),
  quoteSnippet: text('quote_snippet'),
  salienceScore: real('salience_score').notNull().default(0.5),
  confidence: real('confidence').notNull().default(0.5),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().default(now),
}, (table) => [
  index('idx_memory_events_entity').on(table.entityId),
  index('idx_memory_events_salience').on(table.entityId, table.salienceScore),
]);

export const memoryFacts = sqliteTable('memory_facts', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  factType: text('fact_type').notNull(),
  statement: text('statement').notNull(),
  evidenceRefs: text('evidence_refs'),
  salienceScore: real('salience_score').notNull().default(0.5),
  confidence: real('confidence').notNull().default(0.5),
  mergeKey: text('merge_key'),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
}, (table) => [
  index('idx_memory_facts_entity').on(table.entityId),
  index('idx_memory_facts_type').on(table.entityId, table.factType),
]);

export const memorySummaries = sqliteTable('memory_summaries', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  summaryScope: text('summary_scope').notNull(),
  summaryText: text('summary_text').notNull(),
  sourceRange: text('source_range'),
  createdAt: text('created_at').notNull().default(now),
}, (table) => [
  index('idx_memory_summaries_entity').on(table.entityId),
]);

export const relationshipSnapshots = sqliteTable('relationship_snapshots', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  affinityScore: real('affinity_score'),
  trustScore: real('trust_score'),
  emotionalTemperature: real('emotional_temperature'),
  boundarySensitivity: real('boundary_sensitivity'),
  preferredAddressingStyle: text('preferred_addressing_style'),
  lastMeaningfulContactAt: text('last_meaningful_contact_at'),
  updatedAt: text('updated_at').notNull().default(now),
}, (table) => [
  uniqueIndex('idx_relationship_snapshots_entity').on(table.entityId),
]);

export const openLoops = sqliteTable('open_loops', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  loopType: text('loop_type').notNull(),
  status: text('status').notNull().default('open'),
  originEventId: text('origin_event_id').references(() => memoryEvents.id),
  nextFollowupHint: text('next_followup_hint'),
  createdAt: text('created_at').notNull().default(now),
  resolvedAt: text('resolved_at'),
}, (table) => [
  index('idx_open_loops_entity').on(table.entityId, table.status),
]);

// NOTE (SU-ITER-088 · P0-H): (memoryId, memoryKind) is a logical primary key
// but sqlite cannot retro-add PRIMARY KEY without rebuilding the table. A
// composite UNIQUE index enforces the same invariant and enables upsert via
// `.onConflictDoUpdate({ target: [memoryId, memoryKind], ... })`.
// Migration: drizzle/0001_memory_embeddings_unique.sql drops the old
// non-unique index, dedupes existing rows, and creates this unique index.
export const memoryEmbeddings = sqliteTable('memory_embeddings', {
  memoryId: text('memory_id').notNull(),
  memoryKind: text('memory_kind').notNull(),
  embedding: blob('embedding'),
  modelName: text('model_name'),
  createdAt: text('created_at').notNull().default(now),
}, (table) => [
  uniqueIndex('uq_memory_embeddings_id_kind').on(table.memoryId, table.memoryKind),
]);

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: text('applied_at').notNull().default(now),
});
