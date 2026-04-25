import { describe, it, expect } from 'vitest';
import {
  normalizeGenderBucket,
  relationshipCompositeScore,
  relationshipTierFromComposite,
  relationshipTierLabelKey,
} from './resolve-tier';
import type { RelationshipSnapshotRow } from '@/lib/db/db-client';

function row(p: Partial<RelationshipSnapshotRow>): RelationshipSnapshotRow {
  return {
    id: 'r1',
    entityId: 'e1',
    affinityScore: 0,
    trustScore: 0,
    emotionalTemperature: 0,
    boundarySensitivity: 0,
    preferredAddressingStyle: null,
    lastMeaningfulContactAt: null,
    updatedAt: 't',
    ...p,
  };
}

describe('normalizeGenderBucket', () => {
  it('maps common Chinese and English tokens', () => {
    expect(normalizeGenderBucket('男')).toBe('male');
    expect(normalizeGenderBucket('female')).toBe('female');
    expect(normalizeGenderBucket('')).toBe('neutral');
    expect(normalizeGenderBucket('nonbinary')).toBe('neutral');
  });
});

describe('relationshipTierFromComposite', () => {
  it('returns tier 1 for very low composite', () => {
    expect(relationshipTierFromComposite(0)).toBe(1);
    expect(relationshipTierFromComposite(0.05)).toBe(1);
  });

  it('returns tier 5 for high composite', () => {
    expect(relationshipTierFromComposite(0.95)).toBe(5);
  });
});

describe('relationshipTierLabelKey', () => {
  it('uses neutral tier-5 key when either gender unknown', () => {
    expect(relationshipTierLabelKey(5, '', '女')).toBe('relationship.tier.5_neutral');
    expect(relationshipTierLabelKey(5, '男', '')).toBe('relationship.tier.5_neutral');
  });

  it('branches male-male', () => {
    expect(relationshipTierLabelKey(5, 'male', '男')).toBe('relationship.tier.5_m_m');
  });
});

describe('relationshipCompositeScore', () => {
  it('returns 0 for null row', () => {
    expect(relationshipCompositeScore(null)).toBe(0);
  });

  it('is higher when affinity and trust rise', () => {
    const low = relationshipCompositeScore(row({ affinityScore: 0.1, trustScore: 0.1, emotionalTemperature: 0.1, boundarySensitivity: 0 }));
    const high = relationshipCompositeScore(row({ affinityScore: 0.8, trustScore: 0.8, emotionalTemperature: 0.7, boundarySensitivity: 0.1 }));
    expect(high).toBeGreaterThan(low);
  });
});
