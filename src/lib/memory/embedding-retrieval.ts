/**
 * SU-044 Phase 3 — Semantic retrieval over memory_embeddings (linear scan per entity).
 */

import * as dbClient from '@/lib/db/db-client';
import { loadEmbeddingSettingsResolved } from '@/lib/store/embedding-config-store';
import { embedQueryForSearch } from '@/lib/memory/embedding-orchestrate';
import { cosineSimilarity } from '@/lib/memory/embedding-math';

export interface EmbeddingSearchArgs {
  entityId: string;
  /** Natural-language query from the latest user turn. */
  query: string;
  signal?: AbortSignal;
}

const TOP_EVENTS = 5;
const TOP_FACTS = 4;

/**
 * Return memory ids most similar to the query under the active embedding model.
 */
export async function searchMemoryEmbeddings(args: EmbeddingSearchArgs): Promise<{
  eventIds: string[];
  factIds: string[];
}> {
  const { entityId, query, signal } = args;
  const q = query.trim();
  if (!q) return { eventIds: [], factIds: [] };

  const resolved = await loadEmbeddingSettingsResolved();
  if (resolved.mode === 'off') return { eventIds: [], factIds: [] };

  const embedded = await embedQueryForSearch(q, signal);
  if (!embedded) return { eventIds: [], factIds: [] };

  const rows = await dbClient.listMemoryEmbeddingsForEntity(entityId, embedded.modelKey);
  if (rows.length === 0) return { eventIds: [], factIds: [] };

  const scored = rows
    .map((r) => ({
      memoryId: r.memoryId,
      memoryKind: r.memoryKind,
      score: cosineSimilarity(embedded.vector, r.embedding),
    }))
    .filter((r) => r.score > 0 && Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score);

  const eventIds = scored
    .filter((r) => r.memoryKind === 'event')
    .slice(0, TOP_EVENTS)
    .map((r) => r.memoryId);
  const factIds = scored
    .filter((r) => r.memoryKind === 'fact')
    .slice(0, TOP_FACTS)
    .map((r) => r.memoryId);

  return { eventIds, factIds };
}
