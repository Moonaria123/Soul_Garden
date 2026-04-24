-- SU-ITER-088 · P0-H · Enforce composite unique on memory_embeddings.
--
-- Problem: the original schema declared a plain (non-unique) index
-- `idx_memory_embeddings_pk` on (memory_id, memory_kind).  The pair is
-- supposed to uniquely identify an embedding row, but without UNIQUE
-- nothing stops concurrent writers from creating duplicate rows and
-- nothing lets us upsert via ON CONFLICT.
--
-- Fix: dedupe existing rows (keep the most recent), drop the old
-- non-unique index, and create a UNIQUE index so application code can
-- safely use `.onConflictDoUpdate({ target: [memoryId, memoryKind] })`.
--
-- The dedupe keeps the row with the highest rowid (i.e. the most recent
-- insert under sqlite's default rowid behaviour); since the table is
-- currently unused in production this is effectively a no-op, but the
-- clause is required so the migration stays correct if backfill data
-- arrives first.
DELETE FROM memory_embeddings
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM memory_embeddings
  GROUP BY memory_id, memory_kind
);
--> statement-breakpoint
DROP INDEX IF EXISTS idx_memory_embeddings_pk;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memory_embeddings_id_kind` ON `memory_embeddings` (`memory_id`,`memory_kind`);
