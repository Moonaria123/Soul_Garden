import { describe, it, expect } from 'vitest';
import { MemoryEmbeddingUpsertBody } from './route-schemas';

describe('MemoryEmbeddingUpsertBody', () => {
  it('accepts valid payload', () => {
    const r = MemoryEmbeddingUpsertBody.safeParse({
      memoryId: 'e1',
      memoryKind: 'event',
      modelName: 'local:test',
      embedding: [0.1, 0.2, 0.3],
    });
    expect(r.success).toBe(true);
  });

  it('rejects wrong memoryKind', () => {
    const r = MemoryEmbeddingUpsertBody.safeParse({
      memoryId: 'e1',
      memoryKind: 'summary',
      modelName: 'm',
      embedding: [1],
    });
    expect(r.success).toBe(false);
  });
});
