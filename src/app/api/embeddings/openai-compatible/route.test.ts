// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const safeFetch = vi.fn();
vi.mock('@/lib/security/safe-upstream-fetch', () => ({
  safeUpstreamFetch: (url: string, init: RequestInit) => safeFetch(url, init),
  SafeUpstreamError: class extends Error {
    code = 'blocked_by_policy';
    status = 403;
  },
}));

vi.mock('@/lib/llm/upstream-url', () => ({
  isUrlSafe: (u: string) => u.startsWith('https://api.example.com'),
}));

describe('POST /api/embeddings/openai-compatible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards to upstream and returns json', async () => {
    safeFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0, 0, 1] }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const req = new NextRequest('http://localhost/api/embeddings/openai-compatible', {
      method: 'POST',
      body: JSON.stringify({
        baseURL: 'https://api.example.com/v1',
        apiKey: 'k',
        model: 'text-embedding-3-small',
        input: 'x',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
    expect(j.data[0].embedding[2]).toBe(1);
    expect(safeFetch).toHaveBeenCalled();
  });
});
