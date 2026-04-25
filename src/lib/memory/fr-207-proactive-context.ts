/**
 * FR-207 — Inputs for proactive chat / do-not-disturb scheduling (V3.0+).
 * Read-only snapshot; callers must still respect user "勿扰" and ethics (BRD).
 */

import * as dbClient from '@/lib/db/db-client';

export interface ProactiveContextSnapshot {
  openLoops: Awaited<ReturnType<typeof dbClient.listOpenLoops>>;
  relationship: Awaited<ReturnType<typeof dbClient.getRelationshipSnapshot>>;
}

/**
 * Load safe seeds for future proactive-topic drafting (no LLM calls here).
 */
export async function loadProactiveContextSnapshot(
  entityId: string,
): Promise<ProactiveContextSnapshot> {
  const [openLoops, relationship] = await Promise.all([
    dbClient.listOpenLoops(entityId),
    dbClient.getRelationshipSnapshot(entityId),
  ]);
  return { openLoops, relationship };
}
