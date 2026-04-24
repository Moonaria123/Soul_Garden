-- SU-ITER-091-batch2 · P3-12 — add CHECK(status IN (...)) to entities.
--
-- Problem: `entities.status` accepted arbitrary strings because sqlite
-- treats the column as TEXT with no constraint.  The application layer
-- narrows to `EntityStatus = 'draft' | 'extracting' | 'ready' | 'error'`
-- (src/types/index.ts), but a rogue backup import or a manual UPDATE
-- could wedge the store into an unknown status that the UI doesn't
-- render correctly — worst case the entity disappears from every list
-- because `STATUS_KEYS[entity.status]` is undefined and the fallback
-- assumes `'draft'`.
--
-- Approach: the sqlite-endorsed 12-step rebuild pattern (see
-- 0002_chat_messages_entity_fk.sql for the full rationale).  The new
-- table declares the CHECK constraint; unknown rows are coerced to
-- 'draft' during the copy so legacy data never trips the constraint
-- on first boot after upgrade.  The outside-of-txn PRAGMAs sit at the
-- file edges so the migration runner (see migration.ts) can peel them
-- off and execute the body inside a single transaction.

PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE entities_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'extracting', 'ready', 'error')),
  avatar_data TEXT,
  questionnaire_data TEXT,
  soul_docs TEXT,
  text_materials TEXT,
  chat_materials TEXT,
  web_search_materials TEXT,
  background_image TEXT,
  user_call_name TEXT,
  user_perception TEXT,
  nickname TEXT,
  region TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO entities_new (
  id, name, entity_type, status, avatar_data, questionnaire_data,
  soul_docs, text_materials, chat_materials, web_search_materials,
  background_image, user_call_name, user_perception, nickname, region,
  error_message, created_at, updated_at
) SELECT
  id, name, entity_type,
  CASE WHEN status IN ('draft', 'extracting', 'ready', 'error')
       THEN status ELSE 'draft' END,
  avatar_data, questionnaire_data, soul_docs, text_materials,
  chat_materials, web_search_materials, background_image, user_call_name,
  user_perception, nickname, region, error_message, created_at, updated_at
FROM entities;
--> statement-breakpoint
DROP TABLE entities;
--> statement-breakpoint
ALTER TABLE entities_new RENAME TO entities;
--> statement-breakpoint
PRAGMA foreign_key_check;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
