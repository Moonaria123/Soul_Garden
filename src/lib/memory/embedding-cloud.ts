/**
 * SU-044 Phase 3 — OpenAI-compatible embeddings API (user-provided base URL + key).
 */

export interface EmbedTextCloudArgs {
  baseURL: string;
  apiKey: string;
  model: string;
  input: string;
  signal?: AbortSignal;
}

/** Normalize OpenAI-style base (either .../v1 or API root) to /v1/embeddings URL. */
export function openAiEmbeddingsUrl(baseURL: string): string {
  const b = baseURL.trim().replace(/\/+$/, '');
  if (b.endsWith('/v1')) return `${b}/embeddings`;
  return `${b}/v1/embeddings`;
}

/**
 * POST /v1/embeddings and return the first embedding vector.
 * In the browser, calls the same-origin API route to avoid CORS (providers block direct XHR).
 */
export async function embedTextCloud(args: EmbedTextCloudArgs): Promise<number[]> {
  const isBrowser = typeof globalThis !== 'undefined' && 'window' in globalThis;
  if (isBrowser) {
    const res = await fetch('/api/embeddings/openai-compatible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseURL: args.baseURL,
        apiKey: args.apiKey,
        model: args.model,
        input: args.input,
      }),
      signal: args.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`embeddings_http_${res.status}:${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const emb = json?.data?.[0]?.embedding;
    if (!Array.isArray(emb) || emb.length === 0) {
      throw new Error('embeddings_invalid_response');
    }
    return emb.map((n) => Number(n));
  }

  const url = openAiEmbeddingsUrl(args.baseURL);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      input: args.input,
    }),
    signal: args.signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`embeddings_http_${res.status}:${errText.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const emb = json?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) {
    throw new Error('embeddings_invalid_response');
  }
  return emb.map((n) => Number(n));
}

/**
 * Probe embeddings endpoint with a short string; returns dimension count.
 */
export async function probeEmbeddingDims(args: EmbedTextCloudArgs): Promise<number> {
  const v = await embedTextCloud({ ...args, input: 'ping' });
  return v.length;
}
