// ============================================================
// POST /api/llm/test-connection
// Lightweight server-side probe — avoids CORS; returns 200 always
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

interface TestBody {
  baseUrl: string;
  apiKey: string;
  apiType?: ApiType;
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let body: TestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid request body' });
  }

  const { apiType = 'openai-compatible' } = body;
  const apiKey = normalizeApiKeySecret(body.apiKey ?? '');
  if (!body.baseUrl || !apiKey) {
    return NextResponse.json({ success: false, message: 'Missing baseUrl or apiKey' });
  }

  const baseUrl = normaliseBaseUrl(body.baseUrl);
  if (!isUrlSafe(baseUrl)) {
    return NextResponse.json({ success: false, message: 'URL blocked by security policy' });
  }

  const headers = buildModelsProbeHeaders(apiKey, apiType, baseUrl);
  const probeUrl = buildModelsProbeUrl(baseUrl, apiType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    // SU-ITER-089 · P1-5 — no prefix / substring of the API key is ever
    // logged; `secretFingerprint` is irreversible and length-hiding.
    console.log('[test-connection] probeUrl:', probeUrl, 'apiType:', apiType,
      'keyLen:', apiKey.length, 'keyFp:', secretFingerprint(apiKey));

    // SU-ITER-089 · P1-4 — SSRF-safe fetch wraps the existing isUrlSafe
    // allow-list with manual redirect + Location re-validation.
    const res = await safeUpstreamFetch(probeUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return NextResponse.json({ success: true, status: res.status });
    }

    const upstreamBody = await res.text().catch(() => '');
    console.log('[test-connection] upstream status:', res.status, 'body:', upstreamBody.slice(0, 500));

    // OpenAI 兼容（非 Azure）：部分供应商不提供或限制 GET /models，POST chat 仍可用
    const openAiCompatFallback = shouldUseOpenAiCompatibleModelsFallback(baseUrl, apiType);

    if (openAiCompatFallback && (res.status === 404 || res.status === 405)) {
      return NextResponse.json({
        success: true,
        status: res.status,
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
        console.log('[test-connection] chatProbe result:', chatProbeResult);
        if (chatProbeResult.authOk) {
          return NextResponse.json({
            success: true,
            status: res.status,
            hintCode: OPENAI_COMPAT_NO_MODELS_HINT_CODE,
          });
        }
      } catch (probeErr) {
        console.log('[test-connection] chatProbe error:', probeErr);
      } finally {
        clearTimeout(probeTimer);
      }
    }

    // Map known error status codes — include upstream error details
    if (res.status === 401 || res.status === 403) {
      const detail = extractUpstreamErrorDetail(upstreamBody);
      return NextResponse.json({
        success: false,
        message: `Authentication failed (${res.status}). Check your API key.`,
        detail,
        probeUrl,
        status: res.status,
      });
    }

    return NextResponse.json({
      success: false,
      message: `Server returned ${res.status}${upstreamBody ? `: ${upstreamBody.slice(0, 200)}` : ''}`,
      status: res.status,
    });
  } catch (err: unknown) {
    clearTimeout(timer);

    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({ success: false, message: 'Connection timed out (5s)' });
    }
    // SU-ITER-089 · P1-4 — bubble up the SSRF block reason verbatim.
    if (err instanceof SafeUpstreamError) {
      return NextResponse.json({ success: false, message: err.message, code: err.code });
    }

    const msg = err instanceof Error ? err.message : 'Unknown error';
    // DNS / network errors
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return NextResponse.json({ success: false, message: 'DNS resolution failed. Check the URL.' });
    }
    if (msg.includes('ECONNREFUSED')) {
      return NextResponse.json({ success: false, message: 'Connection refused. Is the server running?' });
    }

    return NextResponse.json({ success: false, message: msg.slice(0, 300) });
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
