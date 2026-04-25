// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embedTextCloud, openAiEmbeddingsUrl } from './embedding-cloud';

describe('openAiEmbeddingsUrl', () => {
  it('appends /v1/embeddings when base has no /v1', () => {
    expect(openAiEmbeddingsUrl('https://api.x.com')).toBe('https://api.x.com/v1/embeddings');
  });

  it('appends /embeddings when base already ends with /v1', () => {
    expect(openAiEmbeddingsUrl('https://api.x.com/v1')).toBe('https://api.x.com/v1/embeddings');
  });
});

describe('embedTextCloud', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('parses OpenAI-style embeddings response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, -0.3] }] }),
    }) as unknown as typeof fetch;

    const v = await embedTextCloud({
      baseURL: 'https://api.example.com/v1/',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      input: 'hello',
    });
    expect(v).toEqual([0.1, 0.2, -0.3]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    );
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }) as unknown as typeof fetch;

    await expect(
      embedTextCloud({
        baseURL: 'https://api.example.com',
        apiKey: 'x',
        model: 'm',
        input: 'a',
      }),
    ).rejects.toThrow(/embeddings_http_401/);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
});
