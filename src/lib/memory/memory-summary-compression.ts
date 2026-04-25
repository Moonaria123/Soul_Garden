/**
 * SU-044 Phase 2 — Batch compression of dialogue memory_events into memory_summaries (topic/thread level).
 * Sparse cadence via app_config cursor; runs after structured extraction in chat stream.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { MemoryEventRow, MemorySummaryInsert } from '@/lib/db/db-client';
import * as dbClient from '@/lib/db/db-client';
import type { LLMCallOptions } from '@/lib/agents/llm-client';
import { callLLMDirectFull } from '@/lib/agents/llm-client';
import { CHAT_CONSTANTS } from '@/types';

const SummaryOutSchema = z.object({
  summaryText: z.string().min(1).max(4_000),
});

export function memorySummaryCursorKey(entityId: string): string {
  return `su044.summaryCursor.${entityId}`;
}

/** ISO createdAt of the last event included in a summary batch (exclusive cursor for next batch). */
export async function getMemorySummaryCursor(entityId: string): Promise<string> {
  try {
    const row = await dbClient.getConfig(memorySummaryCursorKey(entityId));
    return (row?.value ?? '').trim();
  } catch {
    return '';
  }
}

export async function setMemorySummaryCursor(entityId: string, isoCreatedAt: string): Promise<void> {
  await dbClient.setConfig(memorySummaryCursorKey(entityId), isoCreatedAt);
}

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) return fence[1].trim();
  return t;
}

/**
 * Pick the next chronological batch of dialogue/imported events after the cursor for summarization.
 * @returns null if fewer than batchMin pending events.
 */
export function selectEventsForNextSummaryBatch(
  events: MemoryEventRow[],
  cursorCreatedAt: string,
  batchMin: number,
): MemoryEventRow[] | null {
  const eligible = [...events]
    .filter((e) => e.source === 'dialogue' || e.source === 'imported')
    .filter((e) => !cursorCreatedAt || e.createdAt > cursorCreatedAt)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  if (eligible.length < batchMin) return null;
  return eligible.slice(0, batchMin);
}

const COMPRESS_SYSTEM = `You compress a batch of short "memory event" records from a private chat companion into one concise summary paragraph.

Rules:
- Use the same language as the event summaries.
- Only merge what is explicitly present; do not invent situations, names, or feelings.
- Be neutral and respectful; avoid clinical or cold tone.
- If the user may be grieving or the topic is about a real deceased person, stay factual and gentle — no motivational clichés, no pretending certainty about the afterlife.
- Output STRICT JSON only: {"summaryText":"..."} — no markdown fences.`;

/**
 * When enough new dialogue events exist after the cursor, run one LLM compression and append a memory_summary row.
 */
export async function maybeCompressTopicSummaries(args: {
  entityId: string;
  llmOptions: LLMCallOptions;
  signal?: AbortSignal;
}): Promise<void> {
  const { entityId, llmOptions, signal } = args;
  const batchMin = CHAT_CONSTANTS.MEMORY_SUMMARY_COMPRESS_BATCH;
  const cursor = await getMemorySummaryCursor(entityId);
  const events = await dbClient.listMemoryEvents(entityId);
  const batch = selectEventsForNextSummaryBatch(events, cursor, batchMin);
  if (!batch || batch.length === 0) return;

  const lines = batch.map(
    (e) =>
      `- [${e.eventType}] ${e.summary}${e.quoteSnippet ? ` — «${e.quoteSnippet}»` : ''}`,
  );
  const raw = await callLLMDirectFull(
    [
      { role: 'system', content: COMPRESS_SYSTEM },
      {
        role: 'user',
        content: `Memory events to compress into one paragraph:\n\n${lines.join('\n')}`,
      },
    ],
    {
      ...llmOptions,
      temperature: 0.15,
      thinkingEnabled: false,
      visionEnabled: false,
      webSearchEnabled: false,
    },
    signal,
  );

  let summaryText: string;
  try {
    const json = JSON.parse(stripJsonFence(raw)) as unknown;
    const check = SummaryOutSchema.safeParse(json);
    if (!check.success) return;
    summaryText = check.data.summaryText.trim();
  } catch {
    return;
  }

  const now = new Date().toISOString();
  const maxCreated = batch.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), batch[0]!.createdAt);

  const row: MemorySummaryInsert = {
    id: uuidv4(),
    entityId,
    summaryScope: 'topic-batch',
    summaryText,
    sourceRange: JSON.stringify({ eventIds: batch.map((e) => e.id) }),
    createdAt: now,
  };

  try {
    await dbClient.insertMemorySummaries([row]);
    await setMemorySummaryCursor(entityId, maxCreated);
  } catch (e) {
    console.error('[memory-summary-compression] persist failed:', e);
  }
}
