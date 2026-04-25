import { beforeEach, describe, expect, it, vi } from 'vitest';

const embedPassage = vi.fn();
vi.mock('@/lib/memory/embedding-orchestrate', () => ({
  embedPassageForStorage: (...args: unknown[]) => embedPassage(...args),
}));

const upsert = vi.fn();
vi.mock('@/lib/db/db-client', () => ({
  upsertMemoryEmbedding: (...args: unknown[]) => upsert(...args),
}));

import { persistMemoryEmbeddingBestEffort } from './memory-embedding-write';

describe('persistMemoryEmbeddingBestEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips upsert when embedder returns null', async () => {
    embedPassage.mockResolvedValue(null);
    const ok = await persistMemoryEmbeddingBestEffort({
      memoryId: '1',
      kind: 'event',
      text: 'x',
    });
    expect(ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts when embedding succeeds', async () => {
    embedPassage.mockResolvedValue({ modelKey: 'm', vector: [0.5] });
    const ok = await persistMemoryEmbeddingBestEffort({
      memoryId: 'id1',
      kind: 'fact',
      text: ' stmt ',
    });
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith({
      memoryId: 'id1',
      memoryKind: 'fact',
      modelName: 'm',
      embedding: [0.5],
    });
  });
});
