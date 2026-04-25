import { describe, it, expect } from 'vitest';
import { computeRelationshipFactCoverage, hasAnyRelationshipFactCoverage } from './fact-coverage';
import type { QuestionnaireData } from '@/types';

function baseQ(): QuestionnaireData {
  return {
    entityType: 'fictional',
    step1: {
      name: 'X',
      gender: '女',
      approximateAge: '',
      culturalBackground: '',
      primaryLanguages: ['zh'],
    },
    step2: {
      personalityKeywords: [],
      speechStyle: { formality: 'casual', verbosity: 'balanced', directness: 'direct' },
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

describe('computeRelationshipFactCoverage', () => {
  it('returns all false when relationship fields are empty', () => {
    const c = computeRelationshipFactCoverage(baseQ());
    expect(hasAnyRelationshipFactCoverage(c)).toBe(false);
    expect(c.affinity).toBe(false);
    expect(c.trust).toBe(false);
    expect(c.emotionalTemperature).toBe(false);
    expect(c.boundarySensitivity).toBe(false);
  });

  it('detects affinity from relationshipType', () => {
    const q = baseQ();
    q.step4.relationshipType = '朋友';
    const c = computeRelationshipFactCoverage(q);
    expect(c.affinity).toBe(true);
    expect(c.trust).toBe(true);
  });

  it('detects boundary from taboo topics', () => {
    const q = baseQ();
    q.step3.tabooTopics = ['death'];
    const c = computeRelationshipFactCoverage(q);
    expect(c.boundarySensitivity).toBe(true);
  });
});
