-- SU-ITER-090b · P2-11 — enforce chat_messages.entity_id → entities.id FK.
--
-- Problem: `chatMessages.entityId` shipped as `NOT NULL` but without a
-- foreign-key reference, so deleting an entity left orphaned rows in
-- `chat_messages` and allowed inserts pointing at a non-existent entity.
-- Drizzle's schema now declares the FK; this migration rebuilds the
-- existing table to pick it up because sqlite cannot ALTER TABLE ADD
-- FOREIGN KEY in place.
--
-- Approach: the sqlite-endorsed 12-step pattern from
-- https://www.sqlite.org/lang_altertable.html#otheralterSteps:
--   1. Turn FK enforcement off (outside txn).
--   2. Inside a txn: dedupe orphans, CREATE TABLE chat_messages_new
--      with the full schema including the FK, copy rows, drop old,
--      rename new into place, recreate indexes, verify FKs, commit.
--   3. Turn FK enforcement back on (outside txn).
--
-- The PRAGMA statements sit at file start/end so the runner (see
-- runMigrations, SU-ITER-090b · P2-18) can peel them off and execute
-- the body inside a single db.transaction(), keeping the rebuild
-- atomic while still honouring sqlite's rule that FK PRAGMAs only
-- take effect outside a transaction.

PRAGMA foreign_keys = OFF;
--> statement-breakpoint
DELETE FROM chat_messages WHERE entity_id NOT IN (SELECT id FROM entities);
--> statement-breakpoint
CREATE TABLE chat_messages_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  token_estimate INTEGER,
  emotion_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO chat_messages_new (id, session_id, entity_id, role, content, timestamp, token_estimate, emotion_hint, created_at)
  SELECT id, session_id, entity_id, role, content, timestamp, token_estimate, emotion_hint, created_at FROM chat_messages;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_chat_messages_session;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_chat_messages_entity;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_chat_messages_timestamp;
--> statement-breakpoint
DROP TABLE chat_messages;
--> statement-breakpoint
ALTER TABLE chat_messages_new RENAME TO chat_messages;
--> statement-breakpoint
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
--> statement-breakpoint
CREATE INDEX idx_chat_messages_entity ON chat_messages(entity_id);
--> statement-breakpoint
CREATE INDEX idx_chat_messages_timestamp ON chat_messages(entity_id, timestamp);
--> statement-breakpoint
PRAGMA foreign_key_check;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
