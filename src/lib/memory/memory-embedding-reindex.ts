/**
 * SU-044 Phase 3 — rebuild vectors for all entities (settings action).
 */

import * as dbClient from '@/lib/db/db-client';
import type { MemoryEventRow, MemoryFactRow } from '@/lib/db/db-client';
import { loadEmbeddingSettingsResolved } from '@/lib/store/embedding-config-store';
import { persistMemoryEmbeddingBestEffort } from '@/lib/memory/memory-embedding-write';

function entityMemoryEnabled(
  e: { continuousMemoryEnabled?: boolean | null } | null | undefined,
): boolean {
  return e?.continuousMemoryEnabled !== false;
}

/** Remove all embedding rows for every entity (vectors can be rebuilt later). */
export async function deleteAllMemoryEmbeddingsGlobally(): Promise<void> {
  const entities = await dbClient.listEntities();
  for (const ent of entities) {
    await dbClient.deleteMemoryEmbeddingsForEntity(ent.id);
  }
}

export async function reindexAllMemoryEmbeddings(
  signal?: AbortSignal,
  onProgress?: (p: { percent: number; current: number; total: number }) => void,
): Promise<{
  entities: number;
  written: number;
  totalSources: number;
  embeddingOff: boolean;
  /** Entities skipped because per-entity continuous memory is off */
  entitiesSkipped: number;
}> {
  const resolved = await loadEmbeddingSettingsResolved();
  if (resolved.mode === 'off') {
    onProgress?.({ percent: 100, current: 0, total: 0 });
    return { entities: 0, written: 0, totalSources: 0, embeddingOff: true, entitiesSkipped: 0 };
  }

  const all = await dbClient.listEntities();
  const included = all.filter((e) => entityMemoryEnabled(e));
  const entitiesSkipped = all.length - included.length;
  onProgress?.({ percent: 0, current: 0, total: 0 });

  const work: Array<{ events: MemoryEventRow[]; facts: MemoryFactRow[] }> = [];
  for (const ent of included) {
    if (signal?.aborted) break;
    await dbClient.deleteMemoryEmbeddingsForEntity(ent.id);
    const [events, facts] = await Promise.all([
      dbClient.listMemoryEvents(ent.id),
      dbClient.listMemoryFacts(ent.id),
    ]);
    work.push({ events, facts });
  }

  const totalSources = work.reduce((s, w) => s + w.events.length + w.facts.length, 0);
  if (totalSources === 0) {
    onProgress?.({ percent: 100, current: 0, total: 0 });
    return {
      entities: included.length,
      written: 0,
      totalSources: 0,
      embeddingOff: false,
      entitiesSkipped,
    };
  }

  let written = 0;
  let current = 0;
  for (const w of work) {
    if (signal?.aborted) break;
    for (const ev of w.events) {
      if (signal?.aborted) break;
      const text = [ev.summary, ev.quoteSnippet ?? ''].filter(Boolean).join('\n');
      const ok = await persistMemoryEmbeddingBestEffort({
        memoryId: ev.id,
        kind: 'event',
        text,
        signal,
      });
      if (ok) written += 1;
      current += 1;
      onProgress?.({
        percent: Math.min(100, Math.round((current / totalSources) * 100)),
        current,
        total: totalSources,
      });
    }
    for (const f of w.facts) {
      if (signal?.aborted) break;
      const ok = await persistMemoryEmbeddingBestEffort({
        memoryId: f.id,
        kind: 'fact',
        text: f.statement,
        signal,
      });
      if (ok) written += 1;
      current += 1;
      onProgress?.({
        percent: Math.min(100, Math.round((current / totalSources) * 100)),
        current,
        total: totalSources,
      });
    }
  }
  onProgress?.({ percent: 100, current, total: totalSources });
  return {
    entities: included.length,
    written,
    totalSources,
    embeddingOff: false,
    entitiesSkipped,
  };
}
