import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadResolved = vi.fn();
vi.mock('@/lib/store/embedding-config-store', () => ({
  loadEmbeddingSettingsResolved: () => loadResolved(),
}));

const listEntities = vi.fn();
const deleteEmb = vi.fn();
const listEvents = vi.fn();
const listFacts = vi.fn();
const persist = vi.fn();

vi.mock('@/lib/db/db-client', () => ({
  listEntities: () => listEntities(),
  deleteMemoryEmbeddingsForEntity: (...a: unknown[]) => deleteEmb(...a),
  listMemoryEvents: (...a: unknown[]) => listEvents(...a),
  listMemoryFacts: (...a: unknown[]) => listFacts(...a),
}));

vi.mock('@/lib/memory/memory-embedding-write', () => ({
  persistMemoryEmbeddingBestEffort: (...a: unknown[]) => persist(...a),
}));

import {
  reindexAllMemoryEmbeddings,
  deleteAllMemoryEmbeddingsGlobally,
} from './memory-embedding-reindex';

describe('deleteAllMemoryEmbeddingsGlobally', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes per entity', async () => {
    listEntities.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await deleteAllMemoryEmbeddingsGlobally();
    expect(deleteEmb).toHaveBeenCalledTimes(2);
    expect(deleteEmb).toHaveBeenCalledWith('a');
    expect(deleteEmb).toHaveBeenCalledWith('b');
  });
});

describe('reindexAllMemoryEmbeddings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns zeros when mode off', async () => {
    loadResolved.mockResolvedValue({ mode: 'off' });
    const r = await reindexAllMemoryEmbeddings();
    expect(r).toEqual({
      entities: 0,
      written: 0,
      totalSources: 0,
      embeddingOff: true,
      entitiesSkipped: 0,
    });
    expect(listEntities).not.toHaveBeenCalled();
  });

  it('clears and persists rows for events and facts', async () => {
    loadResolved.mockResolvedValue({ mode: 'local', activeModelKey: 'mk' });
    persist.mockResolvedValue(true);
    listEntities.mockResolvedValue([{ id: 'ent1' }]);
    listEvents.mockResolvedValue([{ id: 'ev1' }]);
    listFacts.mockResolvedValue([{ id: 'f1' }]);
    const r = await reindexAllMemoryEmbeddings();
    expect(deleteEmb).toHaveBeenCalledWith('ent1');
    expect(persist).toHaveBeenCalledTimes(2);
    expect(r.written).toBe(2);
    expect(r.totalSources).toBe(2);
    expect(r.embeddingOff).toBe(false);
    expect(r.entities).toBe(1);
    expect(r.entitiesSkipped).toBe(0);
  });

  it('does not count writes when persist returns false', async () => {
    loadResolved.mockResolvedValue({ mode: 'local', activeModelKey: 'mk' });
    persist.mockResolvedValue(false);
    listEntities.mockResolvedValue([{ id: 'ent1' }]);
    listEvents.mockResolvedValue([{ id: 'ev1' }]);
    listFacts.mockResolvedValue([]);
    const r = await reindexAllMemoryEmbeddings();
    expect(r.written).toBe(0);
    expect(r.totalSources).toBe(1);
    expect(r.entitiesSkipped).toBe(0);
  });

  it('skips entities with continuous memory off', async () => {
    loadResolved.mockResolvedValue({ mode: 'local', activeModelKey: 'mk' });
    persist.mockResolvedValue(true);
    listEntities.mockResolvedValue([
      { id: 'a', continuousMemoryEnabled: false },
      { id: 'b', continuousMemoryEnabled: true },
    ]);
    listEvents.mockImplementation((id: string) =>
      Promise.resolve(id === 'b' ? [{ id: 'ev1' }] : []),
    );
    listFacts.mockResolvedValue([]);
    const r = await reindexAllMemoryEmbeddings();
    expect(deleteEmb).toHaveBeenCalledTimes(1);
    expect(deleteEmb).toHaveBeenCalledWith('b');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(r.entitiesSkipped).toBe(1);
    expect(r.entities).toBe(1);
  });
});
