/**
 * Score relationship_snapshots from user facts (questionnaire + soul doc excerpts).
 * Reused for first-time seed after soul extraction and for explicit "rebuild relationship".
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { QuestionnaireData, SoulDocs } from '@/types';
import type { LLMCallOptions } from '@/lib/agents/llm-client';
import { callLLMDirectFull } from '@/lib/agents/llm-client';
import * as dbClient from '@/lib/db/db-client';
import {
  computeRelationshipFactCoverage,
  hasAnyRelationshipFactCoverage,
  type RelationshipDimensionCoverage,
} from '@/lib/relationship/fact-coverage';

const ScoreOutSchema = z
  .object({
    affinityScore: z.number().min(0).max(1),
    trustScore: z.number().min(0).max(1),
    emotionalTemperature: z.number().min(0).max(1),
    boundarySensitivity: z.number().min(0).max(1),
    preferredAddressingStyle: z.string().max(500).nullable().optional(),
  })
  .strict();

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) return fence[1].trim();
  return t;
}

function clipDoc(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n…`;
}

function buildQuestionnaireFactsBlock(q: QuestionnaireData): string {
  return JSON.stringify(
    {
      entityType: q.entityType,
      step1: q.step1,
      step2: { personalityKeywords: q.step2.personalityKeywords, coreValues: q.step2.coreValues },
      step3: q.step3,
      step4: q.step4,
    },
    null,
    0,
  );
}

function applyCoverageZeros(
  scores: z.infer<typeof ScoreOutSchema>,
  coverage: RelationshipDimensionCoverage,
): z.infer<typeof ScoreOutSchema> {
  return {
    affinityScore: coverage.affinity ? scores.affinityScore : 0,
    trustScore: coverage.trust ? scores.trustScore : 0,
    emotionalTemperature: coverage.emotionalTemperature ? scores.emotionalTemperature : 0,
    boundarySensitivity: coverage.boundarySensitivity ? scores.boundarySensitivity : 0,
    preferredAddressingStyle: scores.preferredAddressingStyle ?? null,
  };
}

const SYSTEM = `You assign soft numeric relationship state for a private local companion app.
Rules:
- Use ONLY facts explicitly present in the user questionnaire JSON and the excerpted soul documents / memory bullets. Never invent relationship history or events the user did not supply.
- If a dimension has no supporting evidence in the inputs, you MUST output 0 for that dimension.
- Scores are 0..1 floats: affinity (warmth/closeness), trust, emotionalTemperature (expressiveness of bond), boundarySensitivity (how much care is needed around limits; higher = more sensitive).
- Output STRICT JSON only, no markdown:
{"affinityScore":number,"trustScore":number,"emotionalTemperature":number,"boundarySensitivity":number,"preferredAddressingStyle":string|null}
- For real-person entities, stay conservative; no clinical claims.`;

export type SeedRelationshipMode = 'initial' | 'rebuild';

export interface SeedRelationshipSnapshotArgs {
  entityId: string;
  questionnaire: QuestionnaireData;
  soulDocs: Pick<SoulDocs, 'RELATIONSHIP' | 'MEMORY' | 'EMOTIONAL_PATTERNS'>;
  llmOptions: LLMCallOptions;
  signal?: AbortSignal;
  mode: SeedRelationshipMode;
  /** Optional bullets from persisted memory events/facts (rebuild / richer seed). */
  memoryDigest?: string;
}

/**
 * Upsert relationship snapshot from facts. Writes all zeros when no questionnaire coverage
 * and no memory digest; skips LLM in that case. When memoryDigest is present, LLM may use it
 * as extra evidence (still no invention).
 */
export async function seedRelationshipSnapshotFromFacts(args: SeedRelationshipSnapshotArgs): Promise<void> {
  const { entityId, questionnaire, soulDocs, llmOptions, signal, memoryDigest } = args;
  const coverage = computeRelationshipFactCoverage(questionnaire);
  const hasMemory = (memoryDigest?.trim().length ?? 0) >= 20;
  if (!hasAnyRelationshipFactCoverage(coverage) && !hasMemory) {
    await upsertRelationshipSnapshotZeros(entityId);
    return;
  }

  const userBlock = [
    'Questionnaire facts (JSON):',
    buildQuestionnaireFactsBlock(questionnaire),
    '',
    'RELATIONSHIP.md excerpt:',
    clipDoc(soulDocs.RELATIONSHIP ?? '', 6_000),
    '',
    'MEMORY.md excerpt:',
    clipDoc(soulDocs.MEMORY ?? '', 4_000),
    '',
    'EMOTIONAL_PATTERNS excerpt:',
    clipDoc(soulDocs.EMOTIONAL_PATTERNS ?? '', 3_000),
  ];
  if (hasMemory) {
    userBlock.push('', 'Dialogue-derived memory bullets (summaries only, not full chat):', memoryDigest!.trim());
  }

  const raw = await callLLMDirectFull(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userBlock.join('\n') },
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

  let parsed: z.infer<typeof ScoreOutSchema>;
  try {
    const json = JSON.parse(stripJsonFence(raw)) as unknown;
    const check = ScoreOutSchema.safeParse(json);
    if (!check.success) {
      await upsertRelationshipSnapshotZeros(entityId);
      return;
    }
    parsed = check.data;
  } catch {
    await upsertRelationshipSnapshotZeros(entityId);
    return;
  }

  const merged = applyCoverageZeros(
    parsed,
    hasMemory
      ? { affinity: true, trust: true, emotionalTemperature: true, boundarySensitivity: true }
      : coverage,
  );
  const prev = await dbClient.getRelationshipSnapshot(entityId);
  const id = prev?.id ?? uuidv4();
  const now = new Date().toISOString();
  await dbClient.upsertRelationshipSnapshot({
    id,
    entityId,
    affinityScore: merged.affinityScore,
    trustScore: merged.trustScore,
    emotionalTemperature: merged.emotionalTemperature,
    boundarySensitivity: merged.boundarySensitivity,
    preferredAddressingStyle: merged.preferredAddressingStyle ?? null,
    lastMeaningfulContactAt: prev?.lastMeaningfulContactAt ?? null,
    updatedAt: now,
  });
}

/** Public: default relationship row (e.g. after extract when no model is configured). */
export async function upsertRelationshipSnapshotZeros(entityId: string): Promise<void> {
  const prev = await dbClient.getRelationshipSnapshot(entityId);
  const id = prev?.id ?? uuidv4();
  const now = new Date().toISOString();
  await dbClient.upsertRelationshipSnapshot({
    id,
    entityId,
    affinityScore: 0,
    trustScore: 0,
    emotionalTemperature: 0,
    boundarySensitivity: 0,
    preferredAddressingStyle: null,
    lastMeaningfulContactAt: null,
    updatedAt: now,
  });
}

/**
 * Build a short digest of memory events + facts for rebuild prompts (no full transcripts).
 */
export async function buildMemoryDigestForRelationshipRebuild(
  entityId: string,
  maxEvents = 24,
  maxFacts = 24,
): Promise<string> {
  const [events, facts] = await Promise.all([
    dbClient.listMemoryEvents(entityId),
    dbClient.listMemoryFacts(entityId),
  ]);
  const evLines = [...events]
    .filter((e) => e.source === 'dialogue' || e.source === 'imported' || e.source === 'dream')
    .slice(-maxEvents)
    .map((e) => `- [${e.eventType}] ${e.summary.slice(0, 400)}`);
  const factLines = [...facts]
    .slice(-maxFacts)
    .map((f) => `- [${f.factType}] ${f.statement.slice(0, 400)}`);
  if (evLines.length === 0 && factLines.length === 0) return '';
  return [...evLines, ...factLines].join('\n');
}
