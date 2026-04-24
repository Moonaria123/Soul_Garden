'use client';

import type { QuestionnaireData, SoulDocs, ExtractionStep, SoulDocKeyV1, ApiType, TextMaterial } from '@/types';
import { EXTRACTION_STEPS } from '@/types';
import {
  soulPrompt,
  voicePrompt,
  emotionalPatternsPrompt,
  memoryPrompt,
  relationshipPrompt,
} from './prompts/extraction-prompts';
import {
  enrichSoulPrompt,
  enrichVoicePrompt,
  enrichEmotionalPatternsPrompt,
  enrichMemoryPrompt,
  enrichRelationshipPrompt,
} from './prompts/enrichment-prompts';
import { callLLMDirectFull } from './llm-client';

// ============================================================
// Soul Extraction Orchestrator — 5-step serial LLM chain
// V1.1: Now accepts optional textMaterials for enrichment.
// Steps run sequentially because later docs depend on SOUL.md.
// ============================================================

export interface ExtractionCallbacks {
  onProgress: (step: ExtractionStep, message: string, percentage: number) => void;
  onDocGenerated: (key: SoulDocKeyV1, content: string) => void;
  onComplete: (docs: SoulDocs) => void;
  onError: (step: ExtractionStep, error: Error) => void;
  onCancelled?: () => void;
}

interface LLMCallOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  apiType?: ApiType;
}

interface PipelineStep {
  step: ExtractionStep;
  key: SoulDocKeyV1;
  getPrompt: () => string;
}

/**
 * SU-ITER-090c · P2-06 — shared sequential LLM step runner used by both
 * `extractSoul` (build from scratch) and `enrichSoul` (weave new evidence
 * in).  Both call sites shared an identical loop (progress → prompt → LLM
 * → write into `docs` → cancel checks → error routing); pulling it out
 * removes ~30 lines of duplication and makes the cancellation contract
 * authoritative in one place.  The caller owns the initial `docs` seed
 * (empty or existing) so the helper only has to mutate+publish.
 *
 * Length exemption — **RLX-CODE-01** (ITERATION-LOG §SU-092):
 *   function body is ~57 lines, microscopically over the 50-line limit.
 *   Further splitting (e.g. inner `runSingleStep`) would re-introduce a
 *   parameter-passing boundary for the six-way invariant that P2-06
 *   worked hard to collapse into one site:
 *     1. pre-loop abort check,
 *     2. progress dispatch,
 *     3. LLM call with threaded signal,
 *     4. post-LLM abort re-check (fetch may resolve right as abort
 *        fires; SU-092-batch2 `abort-propagation.test.ts` covers this),
 *     5. doc mutation + publish callback,
 *     6. error routing that also distinguishes abort-vs-LLM-error.
 *   Splitting items 1–6 across two helpers would re-duplicate the
 *   cancellation contract and risks drift between `extractSoul` and
 *   `enrichSoul`.  Registered as RLX-CODE-01 so future Gates know the
 *   exemption is intentional and audited.
 */
async function runExtractionPipeline(
  docs: SoulDocs,
  steps: PipelineStep[],
  llmOptions: LLMCallOptions,
  callbacks: ExtractionCallbacks,
  signal: AbortSignal | undefined,
): Promise<SoulDocs> {
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) {
      callbacks.onCancelled?.();
      return docs;
    }

    const { step, key, getPrompt } = steps[i];
    // SU-ITER-092-batch3 · A4-MEDIUM — drop `find(...)!`; every caller
    // routes through `EXTRACTION_STEPS` so the lookup is guaranteed,
    // but an explicit fallback message keeps the UI honest if an
    // unknown step slips through (e.g. during partial refactors).
    const stepInfo = EXTRACTION_STEPS.find((s) => s.step === step);
    const percentage = Math.round((i / steps.length) * 100);

    callbacks.onProgress(step, stepInfo?.message ?? String(step), percentage);

    try {
      // SU-ITER-092-batch2 · AbortSignal threading — pass the caller's
      // signal into `callLLMDirectFull` so an in-flight SSE read is
      // actually torn down on cancel instead of running to completion
      // and only *then* observing `signal?.aborted` in the post-check.
      // The post-check is still kept because the fetch may resolve
      // normally if the abort arrives right as the final token streams.
      const content = await callLLMDirectFull(
        [{ role: 'user', content: getPrompt() }],
        { ...llmOptions, temperature: llmOptions.temperature ?? 0.7 },
        signal,
      );

      if (signal?.aborted) {
        callbacks.onCancelled?.();
        return docs;
      }

      docs[key] = content.trim();
      callbacks.onDocGenerated(key, docs[key]);
    } catch (error) {
      if (signal?.aborted) {
        callbacks.onCancelled?.();
        return docs;
      }
      callbacks.onError(step, error instanceof Error ? error : new Error(String(error)));
      return docs;
    }
  }

  callbacks.onProgress(
    'complete',
    // SU-ITER-092-batch3 · A4-MEDIUM — fallback message keeps this
    // non-null-assertion-free even if the EXTRACTION_STEPS table is
    // trimmed in a future refactor.
    EXTRACTION_STEPS.find((s) => s.step === 'complete')?.message ?? 'complete',
    100,
  );
  callbacks.onComplete(docs);
  return docs;
}

/**
 * Run the full soul extraction pipeline.
 * Calls the LLM 5 times in sequence, building soul docs.
 * V1.1: textMaterials are merged into prompt context for richer extraction.
 * V1.2: webSearchMaterials provide dimensional break context for fictional entities.
 */
export async function extractSoul(
  questionnaire: QuestionnaireData,
  llmOptions: LLMCallOptions,
  callbacks: ExtractionCallbacks,
  signal?: AbortSignal,
  textMaterials?: TextMaterial[],
  webSearchMaterials?: TextMaterial[]
): Promise<SoulDocs> {
  const docs: SoulDocs = {
    SOUL: '',
    VOICE: '',
    EMOTIONAL_PATTERNS: '',
    MEMORY: '',
    RELATIONSHIP: '',
  };

  const combinedMats = [
    ...(webSearchMaterials || []),
    ...(textMaterials || []),
  ];
  const mats = combinedMats.length > 0 ? combinedMats : undefined;

  const steps: PipelineStep[] = [
    {
      step: 'analyzing_personality',
      key: 'SOUL',
      getPrompt: () => soulPrompt(questionnaire, mats),
    },
    {
      step: 'analyzing_voice',
      key: 'VOICE',
      getPrompt: () => voicePrompt(questionnaire, docs.SOUL, mats),
    },
    {
      step: 'analyzing_emotions',
      key: 'EMOTIONAL_PATTERNS',
      getPrompt: () => emotionalPatternsPrompt(questionnaire, docs.SOUL, mats),
    },
    {
      step: 'building_memory',
      key: 'MEMORY',
      getPrompt: () => memoryPrompt(questionnaire, mats),
    },
    {
      step: 'defining_relationship',
      key: 'RELATIONSHIP',
      getPrompt: () => relationshipPrompt(questionnaire, docs.SOUL, mats),
    },
  ];

  return runExtractionPipeline(docs, steps, llmOptions, callbacks, signal);
}

/**
 * Enrich existing soul docs with new text materials.
 * Unlike extractSoul (which builds from scratch), this preserves the
 * existing soul and asks the LLM to weave new evidence into each doc.
 */
export async function enrichSoul(
  existingDocs: SoulDocs,
  questionnaire: QuestionnaireData,
  textMaterials: TextMaterial[],
  llmOptions: LLMCallOptions,
  callbacks: ExtractionCallbacks,
  signal?: AbortSignal
): Promise<SoulDocs> {
  const docs: SoulDocs = { ...existingDocs };

  const steps: PipelineStep[] = [
    {
      step: 'analyzing_personality',
      key: 'SOUL',
      getPrompt: () => enrichSoulPrompt(existingDocs.SOUL, textMaterials, questionnaire),
    },
    {
      step: 'analyzing_voice',
      key: 'VOICE',
      getPrompt: () => enrichVoicePrompt(existingDocs.VOICE, textMaterials, questionnaire, docs.SOUL),
    },
    {
      step: 'analyzing_emotions',
      key: 'EMOTIONAL_PATTERNS',
      getPrompt: () => enrichEmotionalPatternsPrompt(existingDocs.EMOTIONAL_PATTERNS, textMaterials, questionnaire, docs.SOUL),
    },
    {
      step: 'building_memory',
      key: 'MEMORY',
      getPrompt: () => enrichMemoryPrompt(existingDocs.MEMORY, textMaterials, questionnaire),
    },
    {
      step: 'defining_relationship',
      key: 'RELATIONSHIP',
      getPrompt: () => enrichRelationshipPrompt(existingDocs.RELATIONSHIP, textMaterials, questionnaire, docs.SOUL),
    },
  ];

  return runExtractionPipeline(docs, steps, llmOptions, callbacks, signal);
}
