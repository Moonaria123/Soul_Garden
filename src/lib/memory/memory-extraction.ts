/**
 * SU-044 — Structured conversation memory extraction (L1 events + L2 facts).
 * Runs client-side after LLM turns; persists via /api/db (FR-411: no extra plaintext beyond DB).
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '@/types';
import { CHAT_CONSTANTS } from '@/types';
import type { LLMCallOptions } from '@/lib/agents/llm-client';
import { callLLMDirectFull } from '@/lib/agents/llm-client';
import * as dbClient from '@/lib/db/db-client';
import type { MemoryEventInsert, MemoryFactInsert } from '@/lib/db/db-client';
import { persistMemoryEmbeddingBestEffort } from '@/lib/memory/memory-embedding-write';

const EVENT_TYPES = z.enum([
  'conversation-topic',
  'promise',
  'emotion-episode',
  'boundary',
  'milestone',
]);

const FACT_TYPES = z.enum(['preference', 'taboo', 'relationship', 'goal', 'identity', 'routine']);

const ExtractedEventSchema = z.object({
  summary: z.string().min(1).max(4_000),
  eventType: EVENT_TYPES,
  quoteSnippet: z.string().max(2_000).nullable().optional(),
  salienceScore: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const ExtractedFactSchema = z.object({
  statement: z.string().min(1).max(4_000),
  factType: FACT_TYPES,
  mergeKey: z.string().max(256).nullable().optional(),
  salienceScore: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const RelationshipPatchSchema = z
  .object({
    affinityScore: z.number().min(0).max(1).nullable().optional(),
    trustScore: z.number().min(0).max(1).nullable().optional(),
    emotionalTemperature: z.number().min(0).max(1).nullable().optional(),
    boundarySensitivity: z.number().min(0).max(1).nullable().optional(),
    affinityDelta: z.number().min(-0.2).max(0.2).nullable().optional(),
    trustDelta: z.number().min(-0.2).max(0.2).nullable().optional(),
    emotionalTemperatureDelta: z.number().min(-0.2).max(0.2).nullable().optional(),
    boundarySensitivityDelta: z.number().min(-0.2).max(0.2).nullable().optional(),
    preferredAddressingStyle: z.string().max(500).nullable().optional(),
  })
  .strict()
  .optional();

const OpenLoopOutSchema = z.object({
  topic: z.string().min(1).max(2000),
  loopType: z.enum(['follow-up', 'promise', 'pending-decision']),
  nextFollowupHint: z.string().max(2000).nullable().optional(),
});

const ExtractionEnvelopeSchema = z.object({
  events: z.array(ExtractedEventSchema).max(12),
  facts: z.array(ExtractedFactSchema).max(12),
  relationship: RelationshipPatchSchema.nullish(),
  openLoops: z.array(OpenLoopOutSchema).max(8).optional(),
});

export function memoryExtractWatermarkKey(sessionId: string): string {
  return `su044.memlen.${sessionId}`;
}

/** Last persisted message count when extraction ran (stringified int in app_config). */
export async function getMemoryExtractWatermark(sessionId: string): Promise<number> {
  try {
    const row = await dbClient.getConfig(memoryExtractWatermarkKey(sessionId));
    const n = Number.parseInt(row?.value ?? '0', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function setMemoryExtractWatermark(sessionId: string, messageCount: number): Promise<void> {
  await dbClient.setConfig(memoryExtractWatermarkKey(sessionId), String(messageCount));
}

/**
 * Whether another extraction pass should run (sparse cadence).
 */
export function shouldTriggerMemoryExtraction(
  messageCount: number,
  lastExtractedAtCount: number,
): boolean {
  const step = CHAT_CONSTANTS.MEMORY_EXTRACT_TRIGGER_COUNT;
  if (messageCount < step) return false;
  return messageCount >= lastExtractedAtCount + step;
}

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) return fence[1].trim();
  return t;
}

const SYSTEM = `You are a careful memory curator for a private chat companion app.
From the conversation transcript, extract ONLY high-value memories (sparse).

Rules:
- Never invent facts the user did not say or imply.
- Prefer stable preferences, boundaries, promises, emotionally weighted moments, recurring goals.
- Skip small talk, greetings, and one-off trivia with no relational value.
- If the user expresses grief, fear of loss, or discusses a real deceased or seriously ill person: extract only what they clearly stated; do not infer diagnoses, legal facts, or contact third parties; avoid cheerful reframing.
- For "real person" entities, be extra conservative — no embellishing biography or relationships beyond the transcript.
- Output STRICT JSON only (no markdown, no commentary) with this shape:
{"events":[...],"facts":[...]}

events[] items:
- summary: short neutral description in the same language as the chat
- eventType: one of conversation-topic | promise | emotion-episode | boundary | milestone
- quoteSnippet: optional short verbatim quote (same language)
- salienceScore, confidence: optional 0..1

facts[] items:
- statement: compressed stable fact
- factType: preference | taboo | relationship | goal | identity | routine
- mergeKey: optional ASCII slug for dedup (e.g. user_dislikes_cheer_up) — reuse when updating the same fact
- salienceScore, confidence: optional 0..1

Optional top-level keys (Phase 2 — omit when unsure):
- "relationship": adjust relationship state from THIS transcript only. Prefer small deltas (each -0.1..0.1): "affinityDelta", "trustDelta", "emotionalTemperatureDelta", "boundarySensitivityDelta". Alternatively you may output absolute "affinityScore" etc. (0-1) when clearer; server will blend with prior values. Never invent large jumps without clear transcript support. "preferredAddressingStyle": optional string.
- "openLoops": [ { "topic": string, "loopType": "follow-up"|"promise"|"pending-decision", "nextFollowupHint": string|null } ] — unfinished threads worth revisiting.

If nothing is worth remembering, return {"events":[],"facts":[]}.`;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mergeScoreDim(
  prev: number | null | undefined,
  abs: number | null | undefined,
  delta: number | null | undefined,
): number {
  const p = prev == null || Number.isNaN(prev) ? 0 : prev;
  if (delta != null && Number.isFinite(delta)) {
    return clamp01(p + delta);
  }
  if (abs != null && Number.isFinite(abs)) {
    return clamp01(p * 0.65 + abs * 0.35);
  }
  return clamp01(p);
}

function relationshipPatchHasEffect(patch: NonNullable<z.infer<typeof RelationshipPatchSchema>>): boolean {
  if (patch.affinityDelta != null || patch.trustDelta != null) return true;
  if (patch.emotionalTemperatureDelta != null || patch.boundarySensitivityDelta != null) return true;
  if (patch.affinityScore != null || patch.trustScore != null) return true;
  if (patch.emotionalTemperature != null || patch.boundarySensitivity != null) return true;
  if (patch.preferredAddressingStyle != null && String(patch.preferredAddressingStyle).trim() !== '')
    return true;
  return false;
}

/**
 * Merge LLM relationship output into the prior snapshot (deltas preferred).
 */
async function applyRelationshipPatch(
  entityId: string,
  patch: NonNullable<z.infer<typeof RelationshipPatchSchema>>,
  opts?: { touchMemory?: boolean },
): Promise<void> {
  if (!relationshipPatchHasEffect(patch)) return;

  const prev = await dbClient.getRelationshipSnapshot(entityId);
  const id = prev?.id ?? uuidv4();
  const now = new Date().toISOString();

  const affinityScore = mergeScoreDim(
    prev?.affinityScore,
    patch.affinityScore ?? undefined,
    patch.affinityDelta ?? undefined,
  );
  const trustScore = mergeScoreDim(
    prev?.trustScore,
    patch.trustScore ?? undefined,
    patch.trustDelta ?? undefined,
  );
  const emotionalTemperature = mergeScoreDim(
    prev?.emotionalTemperature,
    patch.emotionalTemperature ?? undefined,
    patch.emotionalTemperatureDelta ?? undefined,
  );
  const boundarySensitivity = mergeScoreDim(
    prev?.boundarySensitivity,
    patch.boundarySensitivity ?? undefined,
    patch.boundarySensitivityDelta ?? undefined,
  );

  const preferred =
    patch.preferredAddressingStyle !== undefined && patch.preferredAddressingStyle !== null
      ? patch.preferredAddressingStyle
      : prev?.preferredAddressingStyle ?? null;

  const lastAt =
    opts?.touchMemory === true || relationshipPatchHasEffect(patch) ? now : (prev?.lastMeaningfulContactAt ?? null);

  await dbClient.upsertRelationshipSnapshot({
    id,
    entityId,
    affinityScore,
    trustScore,
    emotionalTemperature,
    boundarySensitivity,
    preferredAddressingStyle: preferred,
    lastMeaningfulContactAt: lastAt,
    updatedAt: now,
  });
}

/** Bump lastMeaningfulContactAt when memory rows were written without relationship patch. */
async function touchRelationshipContactOnly(entityId: string): Promise<void> {
  const prev = await dbClient.getRelationshipSnapshot(entityId);
  const now = new Date().toISOString();
  if (!prev) {
    await dbClient.upsertRelationshipSnapshot({
      id: uuidv4(),
      entityId,
      affinityScore: 0,
      trustScore: 0,
      emotionalTemperature: 0,
      boundarySensitivity: 0,
      preferredAddressingStyle: null,
      lastMeaningfulContactAt: now,
      updatedAt: now,
    });
    return;
  }
  await dbClient.upsertRelationshipSnapshot({
    ...prev,
    lastMeaningfulContactAt: now,
    updatedAt: now,
  });
}

export async function extractAndPersistConversationMemory(args: {
  entityId: string;
  sessionId: string;
  messages: ChatMessage[];
  llmOptions: LLMCallOptions;
  signal?: AbortSignal;
  /**
   * When set, this window is sent to the LLM instead of the last 40 of `messages`.
   */
  transcriptWindow?: ChatMessage[];
  /**
   * When false, skip per-session extract bookkeeping (for chunked historical backfill).
   * @default true
   */
  updateExtractState?: boolean;
}): Promise<void> {
  const { entityId, sessionId, messages, llmOptions, signal, transcriptWindow, updateExtractState } = args;
  const slice = transcriptWindow ?? messages.slice(-40);
  if (slice.length === 0) return;

  const transcript = slice
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const raw = await callLLMDirectFull(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Transcript:\n\n${transcript}` },
    ],
    {
      ...llmOptions,
      temperature: 0.2,
      thinkingEnabled: false,
      visionEnabled: false,
      webSearchEnabled: false,
    },
    signal,
  );

  let parsed: z.infer<typeof ExtractionEnvelopeSchema>;
  try {
    const json = JSON.parse(stripJsonFence(raw)) as unknown;
    const check = ExtractionEnvelopeSchema.safeParse(json);
    if (!check.success) return;
    parsed = check.data;
  } catch {
    return;
  }

  const now = new Date().toISOString();
  const events: MemoryEventInsert[] = parsed.events.map((e) => ({
    id: uuidv4(),
    entityId,
    sessionId,
    source: 'dialogue' as const,
    eventType: e.eventType,
    summary: e.summary,
    quoteSnippet: e.quoteSnippet ?? null,
    salienceScore: e.salienceScore ?? 0.55,
    confidence: e.confidence ?? 0.55,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: now,
  }));

  const facts: MemoryFactInsert[] = parsed.facts.map((f) => ({
    id: uuidv4(),
    entityId,
    factType: f.factType,
    statement: f.statement,
    evidenceRefs: null,
    salienceScore: f.salienceScore ?? 0.55,
    confidence: f.confidence ?? 0.55,
    mergeKey: f.mergeKey ?? null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }));

  if (events.length > 0) {
    await dbClient.insertMemoryEvents(events);
    for (const e of events) {
      const text = [e.summary, e.quoteSnippet ?? ''].filter(Boolean).join('\n');
      void persistMemoryEmbeddingBestEffort({
        memoryId: e.id,
        kind: 'event',
        text,
        signal,
      });
    }
  }
  for (const f of facts) {
    const fid = await dbClient.upsertMemoryFactMerge(f);
    const factId = fid ?? f.id;
    void persistMemoryEmbeddingBestEffort({
      memoryId: factId,
      kind: 'fact',
      text: f.statement,
      signal,
    });
  }

  const touchMemory = events.length > 0 || facts.length > 0;
  if (parsed.relationship) {
    try {
      await applyRelationshipPatch(entityId, parsed.relationship, { touchMemory });
    } catch {
      // Non-blocking — relationship patch is best-effort.
    }
  } else if (touchMemory) {
    try {
      await touchRelationshipContactOnly(entityId);
    } catch {
      // Non-blocking.
    }
  }

  if (parsed.openLoops && parsed.openLoops.length > 0) {
    const loopRows = parsed.openLoops.map((o) => ({
      id: uuidv4(),
      entityId,
      topic: o.topic,
      loopType: o.loopType,
      status: 'open' as const,
      originEventId: null,
      nextFollowupHint: o.nextFollowupHint ?? null,
      createdAt: now,
      resolvedAt: null,
    }));
    try {
      await dbClient.insertOpenLoops(loopRows);
    } catch {
      // Non-blocking.
    }
  }

  if (updateExtractState !== false) {
    await dbClient.upsertSessionState({
      sessionId,
      lastMemoryExtractedAt: now,
    });
    await setMemoryExtractWatermark(sessionId, messages.length);
  }
}
