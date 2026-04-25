/**
 * Re-run memory extraction on historical chat that predates the continuous pipeline.
 * Uses overlapping windows (40 msgs / step 20) to approximate long-context coverage.
 */

import type { ChatMessage } from '@/types';
import type { LLMCallOptions } from '@/lib/agents/llm-client';
import * as dbClient from '@/lib/db/db-client';
import type { ChatMessageRow } from '@/lib/db/db-client';
import { extractAndPersistConversationMemory, setMemoryExtractWatermark } from '@/lib/memory/memory-extraction';

const BACKFILL_WINDOW = 40;
const BACKFILL_STEP = 20;

type Enriched = { message: ChatMessage; sessionId: string };

function rowToEnriched(r: ChatMessageRow): Enriched | null {
  if (r.role !== 'user' && r.role !== 'assistant') return null;
  return {
    sessionId: r.sessionId,
    message: {
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: r.timestamp,
    },
  };
}

/**
 * @returns windows processed, total user/assistant messages in entity
 */
export async function backfillDialogueMemoriesFromHistory(args: {
  entityId: string;
  llmOptions: LLMCallOptions;
  signal?: AbortSignal;
  onProgress?: (p: { current: number; total: number }) => void;
}): Promise<{
  windowsDone: number;
  totalMessageRows: number;
  /** True when the entity has continuous memory off — no work done */
  skipped?: boolean;
}> {
  const ent = await dbClient.getEntity(args.entityId);
  if (ent && ent.continuousMemoryEnabled === false) {
    return { windowsDone: 0, totalMessageRows: 0, skipped: true };
  }

  const rows = await dbClient.listMessagesByEntity(args.entityId);
  const enriched: Enriched[] = rows.map((r) => rowToEnriched(r)).filter((x): x is Enriched => x != null);
  if (enriched.length === 0) {
    return { windowsDone: 0, totalMessageRows: 0 };
  }

  let totalWindows = 0;
  for (let i = 0; i < enriched.length; i += BACKFILL_STEP) {
    const w = enriched.slice(i, i + BACKFILL_WINDOW);
    if (w.length > 0) totalWindows += 1;
  }

  let current = 0;
  for (let i = 0; i < enriched.length; i += BACKFILL_STEP) {
    if (args.signal?.aborted) break;
    const w = enriched.slice(i, i + BACKFILL_WINDOW);
    if (w.length === 0) break;

    const windowMsgs = w.map((e) => e.message);
    const sessionId = w[0].sessionId;
    current += 1;
    args.onProgress?.({ current, total: totalWindows });

    await extractAndPersistConversationMemory({
      entityId: args.entityId,
      sessionId,
      messages: windowMsgs,
      transcriptWindow: windowMsgs,
      updateExtractState: false,
      llmOptions: args.llmOptions,
      signal: args.signal,
    });
  }

  const bySession = new Map<string, number>();
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    bySession.set(r.sessionId, (bySession.get(r.sessionId) ?? 0) + 1);
  }
  const now = new Date().toISOString();
  for (const [sessionId, count] of bySession) {
    await setMemoryExtractWatermark(sessionId, count);
    await dbClient.upsertSessionState({
      sessionId,
      lastMemoryExtractedAt: now,
    });
  }

  return { windowsDone: current, totalMessageRows: enriched.length };
}
