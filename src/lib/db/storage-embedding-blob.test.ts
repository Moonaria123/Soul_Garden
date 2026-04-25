import { describe, it, expect } from 'vitest';
import { memoryEmbeddingBlobToFloats } from './storage-service';

describe('memoryEmbeddingBlobToFloats', () => {
  it('decodes Float32 bytes', () => {
    const f32 = new Float32Array([1, 2, 0.5]);
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    const out = memoryEmbeddingBlobToFloats(u8);
    expect(out).toEqual([1, 2, 0.5]);
  });

  it('returns empty for null', () => {
    expect(memoryEmbeddingBlobToFloats(null)).toEqual([]);
  });
});
