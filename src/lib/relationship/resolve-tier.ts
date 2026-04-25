/**
 * Map numeric relationship snapshot to a discrete tier for UI + i18n keys.
 */

import type { RelationshipSnapshotRow } from '@/lib/db/db-client';

export type RelationshipTierLevel = 1 | 2 | 3 | 4 | 5;

/** Normalized gender bucket for tier-5 label branching. */
export type GenderBucket = 'male' | 'female' | 'neutral';

const TIER_THRESHOLDS = [0.12, 0.28, 0.48, 0.68] as const;

/**
 * Map free-form gender string to bucket (same heuristics as EntityProfileDialog).
 */
export function normalizeGenderBucket(gender: string | undefined | null): GenderBucket {
  const g = (gender ?? '').trim();
  if (!g) return 'neutral';
  const lower = g.toLowerCase();
  if (lower === '男' || lower === 'male' || lower === 'm' || lower === '男性') return 'male';
  if (lower === '女' || lower === 'female' || lower === 'f' || lower === '女性') return 'female';
  return 'neutral';
}

/**
 * Conservative composite: trust floor with affinity, dampen by boundary sensitivity.
 */
export function relationshipCompositeScore(row: RelationshipSnapshotRow | null): number {
  if (!row) return 0;
  const a = row.affinityScore ?? 0;
  const tr = row.trustScore ?? 0;
  const temp = row.emotionalTemperature ?? 0;
  const b = row.boundarySensitivity ?? 0;
  const blended = Math.min(a, tr) * 0.5 + temp * 0.35 + Math.max(a, tr) * 0.15;
  const dampened = blended * (1 - b * 0.35);
  return Math.max(0, Math.min(1, dampened));
}

export function relationshipTierFromComposite(composite: number): RelationshipTierLevel {
  if (composite < TIER_THRESHOLDS[0]) return 1;
  if (composite < TIER_THRESHOLDS[1]) return 2;
  if (composite < TIER_THRESHOLDS[2]) return 3;
  if (composite < TIER_THRESHOLDS[3]) return 4;
  return 5;
}

export function resolveRelationshipTier(row: RelationshipSnapshotRow | null): RelationshipTierLevel {
  return relationshipTierFromComposite(relationshipCompositeScore(row));
}

/** i18n key for tier label (tier 5 picks gendered variant). */
export function relationshipTierLabelKey(
  tier: RelationshipTierLevel,
  userGender: string | undefined | null,
  entityGender: string | undefined | null,
): string {
  if (tier < 5) return `relationship.tier.${tier}`;
  const ug = normalizeGenderBucket(userGender);
  const eg = normalizeGenderBucket(entityGender);
  if (ug === 'neutral' || eg === 'neutral') return 'relationship.tier.5_neutral';
  if (ug === 'male' && eg === 'male') return 'relationship.tier.5_m_m';
  if (ug === 'male' && eg === 'female') return 'relationship.tier.5_m_f';
  if (ug === 'female' && eg === 'female') return 'relationship.tier.5_f_f';
  return 'relationship.tier.5_f_m';
}
