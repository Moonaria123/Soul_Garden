import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadResolved = vi.fn();
vi.mock('@/lib/store/embedding-config-store', () => ({
  loadEmbeddingSettingsResolved: () => loadResolved(),
}));

const embedLocalPassage = vi.fn();
const embedLocalQuery = vi.fn();
vi.mock('@/lib/memory/embedding-local', () => ({
  embedTextLocalPassage: (...args: unknown[]) => embedLocalPassage(...args),
  embedTextLocalQuery: (...args: unknown[]) => embedLocalQuery(...args),
}));

const embedCloud = vi.fn();
vi.mock('@/lib/memory/embedding-cloud', () => ({
  embedTextCloud: (...args: unknown[]) => embedCloud(...args),
}));

import { embedPassageForStorage, embedQueryForSearch } from './embedding-orchestrate';

describe('embedding-orchestrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when off', async () => {
    loadResolved.mockResolvedValue({ mode: 'off' });
    expect(await embedPassageForStorage('hi')).toBeNull();
    expect(embedLocalPassage).not.toHaveBeenCalled();
  });

  it('uses local passage embedder', async () => {
    loadResolved.mockResolvedValue({
      mode: 'local',
      activeModelKey: 'local:x',
      localWeightSource: 'huggingface',
    });
    embedLocalPassage.mockResolvedValue([1, 2]);
    const r = await embedPassageForStorage('a');
    expect(r).toEqual({ modelKey: 'local:x', vector: [1, 2] });
    expect(embedLocalPassage).toHaveBeenCalledWith('a', 'x', undefined, 'huggingface');
  });

  it('uses local query embedder with model id', async () => {
    loadResolved.mockResolvedValue({
      mode: 'local',
      activeModelKey: 'local:m1',
      localWeightSource: 'hfMirror',
    });
    embedLocalQuery.mockResolvedValue([9]);
    const r = await embedQueryForSearch('q');
    expect(r).toEqual({ modelKey: 'local:m1', vector: [9] });
    expect(embedLocalQuery).toHaveBeenCalledWith('q', 'm1', undefined, 'hfMirror');
  });

  it('uses cloud embedder for query', async () => {
    loadResolved.mockResolvedValue({
      mode: 'cloud',
      activeModelKey: 'cloud:z',
      baseURL: 'https://x.com/v1',
      apiKey: 'k',
      modelId: 'm',
    });
    embedCloud.mockResolvedValue([3]);
    const r = await embedQueryForSearch('q');
    expect(r).toEqual({ modelKey: 'cloud:z', vector: [3] });
    expect(embedCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://x.com/v1',
        apiKey: 'k',
        model: 'm',
        input: 'q',
      }),
    );
  });
});
