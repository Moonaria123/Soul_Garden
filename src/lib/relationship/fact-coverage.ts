/**
 * Deterministic flags: which relationship dimensions have user-provided facts
 * in the questionnaire (no LLM). Used to force 0 when a dimension lacks evidence.
 */

import type { QuestionnaireData } from '@/types';

const MIN = 2;

function meaningful(s: string | undefined | null): boolean {
  return (s?.trim().length ?? 0) >= MIN;
}

export type RelationshipDimensionCoverage = {
  affinity: boolean;
  trust: boolean;
  emotionalTemperature: boolean;
  boundarySensitivity: boolean;
};

/**
 * Returns per-dimension coverage from questionnaire fields only.
 */
export function computeRelationshipFactCoverage(q: QuestionnaireData): RelationshipDimensionCoverage {
  const s1 = q.step1;
  const s3 = q.step3;
  const s4 = q.step4;

  const relType = meaningful(s4.relationshipType);
  const mode = meaningful(s4.interactionMode);
  const notes = meaningful(s4.supplementaryNotes);
  const callName = meaningful(s4.userCallName);
  const perception = meaningful(s4.userPerception);

  const realRel = meaningful(s1.realRelationshipToUser);
  const customRole = meaningful(s1.customUserRole);

  const hasBondingFact = relType || mode || notes || perception || callName || realRel || customRole;

  const emotionLines =
    meaningful(s3.typicalMood) ||
    meaningful(s3.emotionalReactions.whenHappy) ||
    meaningful(s3.emotionalReactions.whenAngry) ||
    meaningful(s3.emotionalReactions.whenHurt);

  const boundaryFacts = (s3.tabooTopics?.length ?? 0) > 0 || notes;

  return {
    affinity: hasBondingFact,
    trust: perception || relType || realRel || mode,
    emotionalTemperature: emotionLines || notes || perception,
    boundarySensitivity: boundaryFacts,
  };
}

export function hasAnyRelationshipFactCoverage(c: RelationshipDimensionCoverage): boolean {
  return c.affinity || c.trust || c.emotionalTemperature || c.boundarySensitivity;
}
