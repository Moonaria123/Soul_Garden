import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadResolved = vi.fn();
vi.mock('@/lib/store/embedding-config-store', () => ({
  loadEmbeddingSettingsResolved: () => loadResolved(),
}));

const embedQuery = vi.fn();
vi.mock('@/lib/memory/embedding-orchestrate', () => ({
  embedQueryForSearch: (...args: unknown[]) => embedQuery(...args),
}));

const listEmb = vi.fn();
vi.mock('@/lib/db/db-client', () => ({
  listMemoryEmbeddingsForEntity: (...args: unknown[]) => listEmb(...args),
}));

import { searchMemoryEmbeddings } from './embedding-retrieval';

describe('searchMemoryEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when query blank', async () => {
    const r = await searchMemoryEmbeddings({ entityId: 'e', query: '  ' });
    expect(r).toEqual({ eventIds: [], factIds: [] });
    expect(loadResolved).not.toHaveBeenCalled();
  });

  it('returns empty when embedding mode off', async () => {
    loadResolved.mockResolvedValue({ mode: 'off' });
    const r = await searchMemoryEmbeddings({ entityId: 'e', query: 'hi' });
    expect(r).toEqual({ eventIds: [], factIds: [] });
  });

  it('returns ranked ids when vectors exist', async () => {
    loadResolved.mockResolvedValue({ mode: 'local', activeModelKey: 'mk' });
    embedQuery.mockResolvedValue({ modelKey: 'mk', vector: [1, 0, 0] });
    listEmb.mockResolvedValue([
      { memoryId: 'ev1', memoryKind: 'event', modelName: 'mk', embedding: [1, 0, 0] },
      { memoryId: 'ev2', memoryKind: 'event', modelName: 'mk', embedding: [0, 1, 0] },
      { memoryId: 'fa1', memoryKind: 'fact', modelName: 'mk', embedding: [1, 0, 0] },
    ]);
    const r = await searchMemoryEmbeddings({ entityId: 'ent', query: 'x' });
    expect(r.eventIds[0]).toBe('ev1');
    expect(r.factIds[0]).toBe('fa1');
  });
});
