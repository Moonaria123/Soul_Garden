// @vitest-environment jsdom
// SU-ITER-090c · P2-01 — Zod parser regression tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  safeParseQuestionnaire,
  safeParseSoulDocs,
  emptyQuestionnaire,
  EMPTY_SOUL_DOCS,
  QuestionnaireDataSchema,
  SoulDocsSchema,
} from './entity-schemas';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('safeParseQuestionnaire', () => {
  it('accepts a well-formed payload', () => {
    const payload = {
      entityType: 'custom',
      step1: {
        name: 'Alice',
        gender: 'f',
        approximateAge: '30',
        culturalBackground: '',
        primaryLanguages: ['zh-CN'],
      },
      step2: {
        personalityKeywords: ['kind'],
        speechStyle: { formality: 'casual', verbosity: 'balanced', directness: 'direct' },
        coreValues: ['honesty'],
        catchphrases: [],
      },
      step3: {
        emotionalReactions: { whenHappy: '', whenAngry: '', whenHurt: '' },
        tabooTopics: [],
        typicalMood: '',
      },
      step4: { relationshipType: '', interactionMode: '', supplementaryNotes: '' },
    };
    const out = safeParseQuestionnaire(JSON.stringify(payload), { source: 'test-row-1' });
    expect(out).not.toBeNull();
    expect(out?.entityType).toBe('custom');
    expect(out?.step1.primaryLanguages).toEqual(['zh-CN']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null + warns on malformed JSON', () => {
    const out = safeParseQuestionnaire('not-json{', { source: 'row-bad' });
    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('row-bad');
  });

  it('returns null + warns on schema mismatch (invalid entityType)', () => {
    // Top-level `entityType` is a strict enum — the former `as unknown
    // as QuestionnaireData` cast would have silently accepted any
    // string here; Zod rejects values outside the enum.
    const broken = {
      entityType: 'totally-made-up',
      step1: {},
      step2: {},
      step3: {},
      step4: {},
    };
    const out = safeParseQuestionnaire(JSON.stringify(broken), { source: 'bad-enum' });
    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls.at(-1)?.[0])).toContain('bad-enum');
  });

  it('returns null when a step is not an object (top-level type violation)', () => {
    const broken = {
      entityType: 'custom',
      step1: 'not-an-object',
      step2: {},
      step3: {},
      step4: {},
    };
    const out = safeParseQuestionnaire(JSON.stringify(broken));
    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null on nullish input without warning', () => {
    expect(safeParseQuestionnaire(null)).toBeNull();
    expect(safeParseQuestionnaire(undefined)).toBeNull();
    expect(safeParseQuestionnaire('')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('safeParseSoulDocs', () => {
  it('accepts full soul docs', () => {
    const out = safeParseSoulDocs(JSON.stringify(EMPTY_SOUL_DOCS));
    expect(out).toEqual(EMPTY_SOUL_DOCS);
  });

  it('rejects non-object payloads', () => {
    expect(safeParseSoulDocs('"just a string"')).toBeNull();
    expect(safeParseSoulDocs('42')).toBeNull();
    expect(safeParseSoulDocs('null')).toBeNull();
  });

  it('keeps V1.3 extension fields (APPEARANCE / VOICE_PROFILE)', () => {
    const payload = {
      ...EMPTY_SOUL_DOCS,
      APPEARANCE: 'blue eyes',
      VOICE_PROFILE: 'alto',
    };
    const out = safeParseSoulDocs(JSON.stringify(payload));
    expect(out?.APPEARANCE).toBe('blue eyes');
    expect(out?.VOICE_PROFILE).toBe('alto');
  });
});

describe('emptyQuestionnaire factory', () => {
  it('returns a fresh skeleton that validates against the schema', () => {
    const fresh = emptyQuestionnaire();
    const parsed = QuestionnaireDataSchema.safeParse(fresh);
    expect(parsed.success).toBe(true);
  });

  it('returns a DISTINCT object on each call (no shared mutation risk)', () => {
    const a = emptyQuestionnaire();
    const b = emptyQuestionnaire();
    a.step1.name = 'mutated';
    expect(b.step1.name).toBe('');
  });
});

describe('EMPTY_SOUL_DOCS invariant', () => {
  it('validates against SoulDocsSchema', () => {
    expect(SoulDocsSchema.safeParse(EMPTY_SOUL_DOCS).success).toBe(true);
  });
});
