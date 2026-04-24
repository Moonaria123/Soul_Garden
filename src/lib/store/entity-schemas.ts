// SU-ITER-090c · P2-01 — runtime Zod schemas for persisted entity
// payloads.  Previously `rowToEntity` JSON.parsed row columns and cast
// them straight into `QuestionnaireData` / `SoulDocs` via `as` asserts,
// which silently accepts malformed rows produced by schema drift, a bad
// migration, or a tampered export.  The schemas here are intentionally
// LENIENT on optional fields (most step fields are optional string/bool
// unions) but STRICT on the top-level skeleton so we always know which
// step each object belongs to.  Callers get a typed fallback on parse
// failure and a console warning pointing at the offending row id.

import { z } from 'zod';
import type { QuestionnaireData, SoulDocs, EntityType, ConsciousnessEntity } from '@/types';

// SU-ITER-092-batch3 · Nit cleanup — previously `rowToEntity` cast
// `row.entityType as EntityType` and `row.status as ConsciousnessEntity['status']`
// straight from untrusted JSON.  That let a drifted/tampered row widen
// the union to arbitrary strings, which would then flow into the UI
// (`switch (entity.type)` default branches) and background pipelines.
// These two enums mirror the literal unions in `src/types/index.ts` and
// are enforced at the wire boundary via `parseEntityType` / `parseEntityStatus`.
export const EntityTypeSchema = z.enum(['fictional', 'real_person', 'custom']);
export const EntityStatusSchema = z.enum(['draft', 'extracting', 'ready', 'error']);

/**
 * Narrow a raw row field to the {@link EntityType} union.  Unknown values
 * (schema drift, tampered backup, new type not yet wired on this client)
 * degrade to `'custom'` so the UI still renders the row instead of
 * crashing; a structured warning makes the fallback auditable.
 */
export function parseEntityType(raw: unknown, opts: ParseOpts = {}): EntityType {
  const result = EntityTypeSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[entity-schemas] unknown entityType${opts.source ? ` (source=${opts.source})` : ''} — falling back to 'custom':`,
    raw,
  );
  return 'custom';
}

/**
 * Narrow a raw row field to the {@link ConsciousnessEntity.status} union.
 * Unknown values degrade to `'error'` (the safe-stuck-state) so the UI
 * surfaces the drift instead of silently treating it as `'ready'`.
 */
export function parseEntityStatus(
  raw: unknown,
  opts: ParseOpts = {},
): ConsciousnessEntity['status'] {
  const result = EntityStatusSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[entity-schemas] unknown entity status${opts.source ? ` (source=${opts.source})` : ''} — falling back to 'error':`,
    raw,
  );
  return 'error';
}

const OptionalString = z.string().optional();
const OptionalBoolean = z.boolean().optional();
const StringArray = z.array(z.string()).default([]);

// Step1 — basics + type-specific optional fields.  `.passthrough()` keeps
// forward compatibility: older exports (SU-ITER-046+ informal nickname,
// SU-ITER-024 fictional/real-person fields) still parse even if we
// haven't wired every field explicitly.
const Step1Schema = z
  .object({
    name: z.string().default(''),
    gender: z.string().default(''),
    approximateAge: z.string().default(''),
    culturalBackground: z.string().default(''),
    primaryLanguages: StringArray,
    appearanceDescription: OptionalString,
    voiceDescription: OptionalString,
    informalNickname: OptionalString,
    region: OptionalString,
  })
  .passthrough();

const SpeechStyleSchema = z
  .object({
    formality: z.enum(['formal', 'casual', 'mixed']).default('mixed'),
    verbosity: z.enum(['talkative', 'concise', 'balanced']).default('balanced'),
    directness: z.enum(['direct', 'indirect', 'mixed']).default('mixed'),
  })
  .passthrough();

const Step2Schema = z
  .object({
    personalityKeywords: StringArray,
    speechStyle: SpeechStyleSchema.default({
      formality: 'mixed',
      verbosity: 'balanced',
      directness: 'mixed',
    }),
    coreValues: StringArray,
    catchphrases: StringArray,
  })
  .passthrough();

const Step3Schema = z
  .object({
    emotionalReactions: z
      .object({
        whenHappy: z.string().default(''),
        whenAngry: z.string().default(''),
        whenHurt: z.string().default(''),
      })
      .passthrough()
      .default({ whenHappy: '', whenAngry: '', whenHurt: '' }),
    tabooTopics: StringArray,
    typicalMood: z.string().default(''),
  })
  .passthrough();

const Step4Schema = z
  .object({
    relationshipType: z.string().default(''),
    interactionMode: z.string().default(''),
    supplementaryNotes: z.string().default(''),
    userCallName: OptionalString,
    userPerception: OptionalString,
    ethicsConsentAcknowledged: OptionalBoolean,
  })
  .passthrough();

export const QuestionnaireDataSchema = z
  .object({
    entityType: z.enum(['fictional', 'real_person', 'custom']),
    step1: Step1Schema,
    step2: Step2Schema,
    step3: Step3Schema,
    step4: Step4Schema,
  })
  .passthrough();

export const SoulDocsSchema = z
  .object({
    SOUL: z.string().default(''),
    VOICE: z.string().default(''),
    EMOTIONAL_PATTERNS: z.string().default(''),
    MEMORY: z.string().default(''),
    RELATIONSHIP: z.string().default(''),
    APPEARANCE: OptionalString,
    VOICE_PROFILE: OptionalString,
  })
  .passthrough();

// SU-ITER-090c · P2-01 NIT cleanup (mini-Gate N-1) — frozen to prevent
// a future caller from assigning into the shared singleton instead of
// spreading it (`{ ...EMPTY_SOUL_DOCS }`).  All current read sites use
// the spread form, so freezing is a belt-and-suspenders guard.
export const EMPTY_SOUL_DOCS: SoulDocs = Object.freeze({
  SOUL: '',
  VOICE: '',
  EMOTIONAL_PATTERNS: '',
  MEMORY: '',
  RELATIONSHIP: '',
}) as SoulDocs;

/**
 * Build a blank questionnaire skeleton.  Callers that need a fresh draft
 * should call this factory rather than importing a shared mutable
 * singleton (the singleton used to be a hand-rolled literal asserted
 * with `as unknown as QuestionnaireData`, which both masked drift from
 * the real type and created a shared-reference footgun when later code
 * mutated `step4`).
 */
export function emptyQuestionnaire(): QuestionnaireData {
  return {
    entityType: 'custom',
    step1: {
      name: '',
      gender: '',
      approximateAge: '',
      culturalBackground: '',
      primaryLanguages: [],
    },
    step2: {
      personalityKeywords: [],
      speechStyle: { formality: 'mixed', verbosity: 'balanced', directness: 'mixed' },
      coreValues: [],
      catchphrases: [],
    },
    step3: {
      emotionalReactions: { whenHappy: '', whenAngry: '', whenHurt: '' },
      tabooTopics: [],
      typicalMood: '',
    },
    step4: {
      relationshipType: '',
      interactionMode: '',
      supplementaryNotes: '',
    },
  };
}

interface ParseOpts {
  /** Opaque tag used purely for log provenance (row id, import name, etc.). */
  source?: string;
}

/**
 * JSON.parse + Zod validate in one go.  Returns the schema-parsed value
 * on success, otherwise returns `null` and logs a structured warning so
 * callers can substitute a safe fallback without masking the error.
 * Returns `null` for nullish / empty JSON input too (callers treat it
 * the same as a parse failure and pick their own default).
 */
export function safeParseQuestionnaire(
  json: string | null | undefined,
  opts: ParseOpts = {},
): QuestionnaireData | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    console.warn(
      `[entity-schemas] questionnaireData JSON.parse failed${opts.source ? ` (source=${opts.source})` : ''}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
  const result = QuestionnaireDataSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[entity-schemas] questionnaireData schema mismatch${opts.source ? ` (source=${opts.source})` : ''}:`,
      result.error.issues.slice(0, 3),
    );
    return null;
  }
  // zod `.passthrough()` returns the original shape with unknown fields
  // preserved; the cast is safe because the schema mirrors the type.
  return result.data as QuestionnaireData;
}

export function safeParseSoulDocs(
  json: string | null | undefined,
  opts: ParseOpts = {},
): SoulDocs | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    console.warn(
      `[entity-schemas] soulDocs JSON.parse failed${opts.source ? ` (source=${opts.source})` : ''}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
  const result = SoulDocsSchema.safeParse(raw);
  if (!result.success) {
    console.warn(
      `[entity-schemas] soulDocs schema mismatch${opts.source ? ` (source=${opts.source})` : ''}:`,
      result.error.issues.slice(0, 3),
    );
    return null;
  }
  return result.data as SoulDocs;
}
