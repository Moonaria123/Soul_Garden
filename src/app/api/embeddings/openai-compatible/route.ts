// Same-origin proxy for OpenAI-style POST /v1/embeddings (SU-044) — browser cannot
// call most embedding APIs due to CORS; this route forwards with SSRF protection.

import { NextRequest, NextResponse } from 'next/server';
import { z, type ZodError } from 'zod';
import { isUrlSafe } from '@/lib/llm/upstream-url';
import { openAiEmbeddingsUrl } from '@/lib/memory/embedding-cloud';
import {
  safeUpstreamFetch,
  SafeUpstreamError,
} from '@/lib/security/safe-upstream-fetch';

const BodySchema = z.object({
  baseURL: z.string().min(1).max(2_000),
  apiKey: z.string().min(1).max(8_000),
  model: z.string().min(1).max(512),
  input: z.string().max(500_000),
});

function zodToResponse(err: ZodError) {
  return NextResponse.json(
    { error: 'invalid_request', details: err.flatten() },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return zodToResponse(parsed.error);

  const { baseURL, apiKey, model, input } = parsed.data;
  if (!isUrlSafe(baseURL.trim())) {
    return NextResponse.json({ error: 'base_url_not_allowed' }, { status: 403 });
  }

  const targetUrl = openAiEmbeddingsUrl(baseURL);
  if (!isUrlSafe(targetUrl)) {
    return NextResponse.json({ error: 'url_not_allowed' }, { status: 403 });
  }

  try {
    const res = await safeUpstreamFetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ model, input }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return NextResponse.json(
        { error: 'upstream_error', status: res.status, body: t.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof SafeUpstreamError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'embeddings_proxy_failed' },
      { status: 500 },
    );
  }
}
