/**
 * SU-044 Phase 3 — best-effort persist of vectors after memory rows exist.
 */

import * as dbClient from '@/lib/db/db-client';
import { embedPassageForStorage } from '@/lib/memory/embedding-orchestrate';

/**
 * @returns true if a row was written; false if skipped (embeddings off) or on failure.
 */
export async function persistMemoryEmbeddingBestEffort(args: {
  memoryId: string;
  kind: 'event' | 'fact';
  text: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  try {
    const t = args.text.trim() || ' ';
    const emb = await embedPassageForStorage(t, args.signal);
    if (!emb) return false;
    await dbClient.upsertMemoryEmbedding({
      memoryId: args.memoryId,
      memoryKind: args.kind,
      modelName: emb.modelKey,
      embedding: emb.vector,
    });
    return true;
  } catch (e) {
    console.warn('[memory-embedding] persist failed', e);
    return false;
  }
}
