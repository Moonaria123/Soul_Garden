import { describe, it, expect } from 'vitest';
import type { MemoryEventRow } from '@/lib/db/db-client';
import { selectEventsForNextSummaryBatch } from './memory-summary-compression';
import { CHAT_CONSTANTS } from '@/types';

function row(p: {
  id: string;
  createdAt: string;
  source: string;
  summary?: string;
}): MemoryEventRow {
  return {
    id: p.id,
    entityId: 'e1',
    sessionId: 's1',
    source: p.source,
    eventType: 'conversation-topic',
    summary: p.summary ?? 'x',
    quoteSnippet: null,
    salienceScore: 0.5,
    confidence: 0.5,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: p.createdAt,
  };
}

describe('selectEventsForNextSummaryBatch', () => {
  const batch = CHAT_CONSTANTS.MEMORY_SUMMARY_COMPRESS_BATCH;

  it('returns null when fewer than batchMin eligible events after cursor', () => {
    const events = Array.from({ length: batch - 1 }, (_, i) =>
      row({ id: `a${i}`, createdAt: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, source: 'dialogue' }),
    );
    expect(selectEventsForNextSummaryBatch(events, '', batch)).toBeNull();
  });

  it('returns the oldest pending dialogue batch of size batchMin', () => {
    const events = Array.from({ length: batch + 3 }, (_, i) =>
      row({
        id: `e${i}`,
        createdAt: `2025-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        source: 'dialogue',
      }),
    );
    const got = selectEventsForNextSummaryBatch(events, '', batch);
    expect(got).not.toBeNull();
    expect(got!.length).toBe(batch);
    expect(got![0]!.id).toBe('e0');
    expect(got![batch - 1]!.id).toBe(`e${batch - 1}`);
  });

  it('excludes dream and only counts dialogue/imported after cursor', () => {
    const events: MemoryEventRow[] = [
      row({ id: 'd0', createdAt: '2025-03-01T00:00:00.000Z', source: 'dream' }),
      ...Array.from({ length: batch }, (_, i) =>
        row({
          id: `d${i + 1}`,
          createdAt: `2025-03-${String(i + 2).padStart(2, '0')}T00:00:00.000Z`,
          source: 'dialogue',
        }),
      ),
    ];
    const got = selectEventsForNextSummaryBatch(events, '', batch);
    expect(got).not.toBeNull();
    expect(got!.every((e) => e.source === 'dialogue')).toBe(true);
    expect(got![0]!.id).toBe('d1');
  });

  it('respects cursor createdAt (strictly greater)', () => {
    const events = [
      row({ id: 'old', createdAt: '2025-04-01T00:00:00.000Z', source: 'dialogue' }),
      ...Array.from({ length: batch }, (_, i) =>
        row({
          id: `n${i}`,
          createdAt: `2025-04-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
          source: 'dialogue',
        }),
      ),
    ];
    const got = selectEventsForNextSummaryBatch(events, '2025-04-01T00:00:00.000Z', batch);
    expect(got).not.toBeNull();
    expect(got![0]!.id).toBe('n0');
  });
});
