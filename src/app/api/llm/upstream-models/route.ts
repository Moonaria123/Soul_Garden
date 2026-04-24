// ============================================================
// POST /api/llm/upstream-models
// Server-side proxy to fetch model lists — avoids CORS
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { normaliseBaseUrl, isUrlSafe, buildModelsProbeUrl } from '@/lib/llm/upstream-url';
import { buildModelsProbeHeaders } from '@/lib/llm/upstream-auth';
import { normalizeApiKeySecret } from '@/lib/llm/api-key';
import {
  OPENAI_COMPAT_NO_MODELS_HINT_CODE,
  shouldUseOpenAiCompatibleModelsFallback,
  probeOpenAiCompatibleChatAuth,
} from '@/lib/llm/openai-compatible-probe';
import type { ApiType } from '@/types';
import { localhostGuard } from '@/lib/security/localhost-guard';
import { secretFingerprint } from '@/lib/security/redact';
import {
  safeUpstreamFetch,
  SafeUpstreamError,
} from '@/lib/security/safe-upstream-fetch';

interface FetchBody {
  baseUrl: string;
  apiKey: string;
  apiType?: ApiType;
}

interface UpstreamModel {
  id: string;
  owned_by?: string;
  created?: number;
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let body: FetchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ models: [], error: 'Invalid request body' }, { status: 400 });
  }

  const { apiType = 'openai-compatible' } = body;
  const apiKey = normalizeApiKeySecret(body.apiKey ?? '');
  if (!body.baseUrl || !apiKey) {
    return NextResponse.json({ models: [], error: 'Missing baseUrl or apiKey' }, { status: 400 });
  }

  const baseUrl = normaliseBaseUrl(body.baseUrl);
  if (!isUrlSafe(baseUrl)) {
    return NextResponse.json({ models: [], error: 'URL blocked by security policy' }, { status: 403 });
  }

  const headers = buildModelsProbeHeaders(apiKey, apiType, baseUrl);
  const modelsUrl = buildModelsProbeUrl(baseUrl, apiType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    // SU-ITER-089 · P1-5 — do NOT log any prefix or substring of the API
    // key.  `secretFingerprint` gives an irreversible, length-hiding token
    // for correlating multiple log lines from the same caller.
    console.log('[upstream-models] modelsUrl:', modelsUrl, 'apiType:', apiType,
      'keyLen:', apiKey.length, 'keyFp:', secretFingerprint(apiKey));

    // SU-ITER-089 · P1-4 — SSRF-safe fetch: manual redirect + Location
    // allow-list so a public baseUrl cannot 302 us at an internal IP.
    const res = await safeUpstreamFetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const upstreamBody = await res.text().catch(() => '');
      console.log('[upstream-models] upstream status:', res.status, 'body:', upstreamBody.slice(0, 500));

      const openAiCompatFallback = shouldUseOpenAiCompatibleModelsFallback(
        baseUrl,
        apiType
      );

      if (openAiCompatFallback && (res.status === 404 || res.status === 405)) {
        return NextResponse.json({
          models: [],
          hintCode: OPENAI_COMPAT_NO_MODELS_HINT_CODE,
        });
      }

      if (openAiCompatFallback && (res.status === 401 || res.status === 403)) {
        const probe = new AbortController();
        const probeTimer = setTimeout(() => probe.abort(), 5000);
        try {
          const chatProbeResult = await probeOpenAiCompatibleChatAuth(
            baseUrl,
            apiKey,
            probe.signal
          );
          console.log('[upstream-models] chatProbe result:', chatProbeResult);
          if (chatProbeResult.authOk) {
            return NextResponse.json({
              models: [],
              hintCode: OPENAI_COMPAT_NO_MODELS_HINT_CODE,
            });
          }
        } catch {
          /* fall through */
        } finally {
          clearTimeout(probeTimer);
        }
      }

      if (res.status === 401 || res.status === 403) {
        const detail = extractUpstreamErrorDetail(upstreamBody);
        return NextResponse.json({
          models: [],
          error: `Authentication failed (${res.status}). Check your API key.`,
          detail,
        });
      }
      return NextResponse.json({
        models: [],
        error: `Server returned ${res.status}${upstreamBody ? `: ${upstreamBody.slice(0, 200)}` : ''}`,
      });
    }

    const data = await res.json();

    // OpenAI-compatible format: { data: [...] }
    // Anthropic format: { data: [...] } (same structure)
    const rawModels: UpstreamModel[] = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

    const models = rawModels.map((m) => ({
      id: m.id,
      owned_by: m.owned_by,
      created: m.created,
    }));

    return NextResponse.json({ models });
  } catch (err: unknown) {
    clearTimeout(timer);

    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({ models: [], error: 'Request timed out (15s)' });
    }
    // SU-ITER-089 · P1-4 — surface SSRF blocks as a distinct shape so
    // the UI can render the reason instead of a generic network error.
    if (err instanceof SafeUpstreamError) {
      return NextResponse.json({ models: [], error: err.message, code: err.code });
    }

    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return NextResponse.json({ models: [], error: 'DNS resolution failed. Check the URL.' });
    }
    if (msg.includes('ECONNREFUSED')) {
      return NextResponse.json({ models: [], error: 'Connection refused. Is the server running?' });
    }

    return NextResponse.json({ models: [], error: msg.slice(0, 300) });
  }
}

function extractUpstreamErrorDetail(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const obj = JSON.parse(body);
    const msg =
      obj?.error?.message ?? obj?.message ?? obj?.error_msg ?? obj?.msg;
    if (typeof msg === 'string') return msg.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300);
}
