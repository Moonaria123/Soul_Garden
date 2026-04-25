/**
 * SU-044 — Low-noise retrieval of L1/L2 memory for prompt injection.
 * Phase 3: `searchMemoryEmbeddings` can boost ids once embeddings are populated.
 */

import * as dbClient from '@/lib/db/db-client';
import { searchMemoryEmbeddings } from '@/lib/memory/embedding-retrieval';
import type {
  MemoryEventRow,
  MemoryFactRow,
  MemorySummaryRow,
  OpenLoopRow,
  RelationshipSnapshotRow,
} from '@/lib/db/db-client';

const MAX_EVENTS = 5;
const MAX_FACTS = 8;
const MAX_OPEN_LOOPS = 3;
const MAX_TOPIC_SUMMARIES = 2;
/** Keep topic summaries from crowding the system prompt. */
const MAX_SUMMARY_TEXT_CHARS = 900;

const SEMANTIC_BOOST_EVENT = 0.22;
const SEMANTIC_BOOST_FACT = 0.18;

function scoreEvent(
  row: MemoryEventRow,
  queryLower: string,
  semanticHit: boolean,
): number {
  const salience = row.salienceScore ?? 0.5;
  const dreamPenalty = row.source === 'dream' ? -0.2 : 0;
  const text = `${row.summary} ${row.quoteSnippet ?? ''}`.toLowerCase();
  let rel = 0;
  if (queryLower.length > 0) {
    const tokens = queryLower.split(/\s+/).filter((t) => t.length > 1);
    for (const t of tokens) {
      if (text.includes(t)) rel += 0.15;
    }
    rel = Math.min(rel, 0.6);
  }
  const ts = row.createdAt ? new Date(row.createdAt).getTime() : 0;
  const recency = ts > 0 ? Math.min(0.25, (Date.now() - ts) / (1000 * 86400 * 30) * -0.25 + 0.25) : 0;
  const sem = semanticHit ? SEMANTIC_BOOST_EVENT : 0;
  return salience * 0.55 + rel + recency + dreamPenalty + sem;
}

function scoreFact(row: MemoryFactRow, queryLower: string, semanticHit: boolean): number {
  const salience = row.salienceScore ?? 0.5;
  const text = row.statement.toLowerCase();
  let rel = 0;
  if (queryLower.length > 0) {
    const tokens = queryLower.split(/\s+/).filter((t) => t.length > 1);
    for (const t of tokens) {
      if (text.includes(t)) rel += 0.12;
    }
    rel = Math.min(rel, 0.55);
  }
  const boundaryBoost =
    row.factType === 'taboo' || row.factType === 'relationship' ? 0.12 : 0;
  const ts = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  const recency = ts > 0 ? Math.min(0.2, (Date.now() - ts) / (1000 * 86400 * 60) * -0.2 + 0.2) : 0;
  const sem = semanticHit ? SEMANTIC_BOOST_FACT : 0;
  return salience * 0.5 + rel + boundaryBoost + recency + sem;
}

function formatOpenLoops(loops: OpenLoopRow[]): string {
  if (loops.length === 0) return '';
  const lines = loops.map(
    (l) =>
      `- (${l.loopType}) ${l.topic}${l.nextFollowupHint ? ` — ${l.nextFollowupHint}` : ''}`,
  );
  return `### 未完成话题\n\n${lines.join('\n')}`;
}

function formatTopicSummaries(rows: MemorySummaryRow[]): string {
  if (rows.length === 0) return '';
  const lines = rows.map((r) => {
    const text =
      r.summaryText.length > MAX_SUMMARY_TEXT_CHARS
        ? `${r.summaryText.slice(0, MAX_SUMMARY_TEXT_CHARS)}…`
        : r.summaryText;
    return `- (${r.summaryScope}) ${text}`;
  });
  return `### 主题摘要（压缩）\n\n${lines.join('\n')}`;
}

function relationshipHasSignal(row: RelationshipSnapshotRow): boolean {
  return (
    row.affinityScore != null ||
    row.trustScore != null ||
    row.emotionalTemperature != null ||
    row.boundarySensitivity != null ||
    (row.preferredAddressingStyle != null && row.preferredAddressingStyle.trim() !== '')
  );
}

function formatRelationshipSnapshot(row: RelationshipSnapshotRow | null): string {
  if (!row || !relationshipHasSignal(row)) return '';
  const bits: string[] = [];
  if (row.affinityScore != null) bits.push(`亲和 ${row.affinityScore.toFixed(2)}`);
  if (row.trustScore != null) bits.push(`信任 ${row.trustScore.toFixed(2)}`);
  if (row.emotionalTemperature != null) bits.push(`情绪温度 ${row.emotionalTemperature.toFixed(2)}`);
  if (row.boundarySensitivity != null) bits.push(`边界敏感 ${row.boundarySensitivity.toFixed(2)}`);
  if (row.preferredAddressingStyle?.trim())
    bits.push(`称呼偏好：${row.preferredAddressingStyle.trim()}`);
  return `### 关系状态（快照）\n\n${bits.join(' · ')}`;
}

/**
 * Build a read-only "对话期记忆" block for system prompt injection.
 * @param userMessageLatest - latest user text for light lexical relevance
 */
export async function buildConversationMemoryPromptBlock(
  entityId: string,
  userMessageLatest: string,
): Promise<string> {
  const ent = await dbClient.getEntity(entityId);
  if (ent && ent.continuousMemoryEnabled === false) {
    return '';
  }

  const [{ eventIds: semanticEventIds, factIds: semanticFactIds }, events, facts, loops, summaries, relationship] =
    await Promise.all([
      searchMemoryEmbeddings({ entityId, query: userMessageLatest }),
      dbClient.listMemoryEvents(entityId),
      dbClient.listMemoryFacts(entityId),
      dbClient.listOpenLoops(entityId),
      dbClient.listMemorySummaries(entityId),
      dbClient.getRelationshipSnapshot(entityId),
    ]);
  const semanticEventSet = new Set(semanticEventIds);
  const semanticFactSet = new Set(semanticFactIds);

  const queryLower = userMessageLatest.trim().toLowerCase();

  const openLoops = loops
    .filter((l) => l.status === 'open')
    .slice(0, MAX_OPEN_LOOPS * 2)
    .slice(0, MAX_OPEN_LOOPS);

  const latestSummaries = [...summaries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_TOPIC_SUMMARIES);

  const rankedEvents = [...events]
    .filter((e) =>
      e.source === 'dialogue' || e.source === 'imported' || e.source === 'dream',
    )
    .sort(
      (a, b) =>
        scoreEvent(b, queryLower, semanticEventSet.has(b.id)) -
        scoreEvent(a, queryLower, semanticEventSet.has(a.id)),
    )
    .slice(0, MAX_EVENTS);

  const rankedFacts = [...facts]
    .sort(
      (a, b) =>
        scoreFact(b, queryLower, semanticFactSet.has(b.id)) -
        scoreFact(a, queryLower, semanticFactSet.has(a.id)),
    )
    .slice(0, MAX_FACTS);

  const relBlock = formatRelationshipSnapshot(relationship);
  const summaryBlock = formatTopicSummaries(latestSummaries);

  if (
    rankedEvents.length === 0 &&
    rankedFacts.length === 0 &&
    openLoops.length === 0 &&
    !relBlock &&
    !summaryBlock
  ) {
    return '';
  }

  const parts: string[] = [
    '## 对话期持续记忆（只读，来自真实聊天沉淀）',
    '',
    '以下条目来自你与用户的对话，不是问卷或素材文档；请自然使用，不要声称它们来自「设定稿」。',
    '不要编造未列出的回忆。',
    '',
  ];

  if (summaryBlock) {
    parts.push(summaryBlock);
    parts.push('');
  }

  if (relBlock) {
    parts.push(relBlock);
    parts.push('');
  }

  if (rankedFacts.length > 0) {
    parts.push('### 稳定事实与偏好\n');
    for (const f of rankedFacts) {
      parts.push(`- [${f.factType}] ${f.statement}`);
    }
    parts.push('');
  }

  if (rankedEvents.length > 0) {
    parts.push('### 近期重要事件\n');
    for (const e of rankedEvents) {
      const q = e.quoteSnippet ? ` — 原话片段：「${e.quoteSnippet}」` : '';
      parts.push(`- [${e.eventType}] ${e.summary}${q}`);
    }
    parts.push('');
  }

  const loopBlock = formatOpenLoops(openLoops);
  if (loopBlock) {
    parts.push(loopBlock);
    parts.push('');
  }

  return parts.join('\n').trim();
}
