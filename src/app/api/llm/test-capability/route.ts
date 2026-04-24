// ============================================================
// POST /api/llm/test-capability  (SU-ITER-084)
//
// Multi-vendor capability probe — detects provider profile from
// baseURL + apiType and sends the *correct* payload for each
// vendor (OpenAI, Azure, Anthropic, DashScope, generic).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { normaliseBaseUrl, isUrlSafe } from '@/lib/llm/upstream-url';
import { normalizeApiKeySecret } from '@/lib/llm/api-key';
import {
  detectProviderProfile,
  buildCapabilityProbeUrl,
  buildCapabilityProbeHeaders,
  buildCapabilityProbePayload,
  responseContainsThinking,
  isClaudeModel,
} from '@/lib/llm/capability-probe-profiles';
import type { ApiType } from '@/types';
import { localhostGuard } from '@/lib/security/localhost-guard';
import {
  safeUpstreamFetch,
  SafeUpstreamError,
} from '@/lib/security/safe-upstream-fetch';

interface TestCapBody {
  capability: 'thinking' | 'vision' | 'webSearch';
  baseURL: string;
  apiKey: string;
  model: string;
  apiType?: ApiType;
  thinkingBudget?: number;
}

const UNSUPPORTED_PATTERNS = [
  /not support/i, /unsupported/i, /not available/i,
  /unknown.*param/i, /unrecognized/i,
  /does not have/i, /not enabled/i, /not allowed/i,
  /not compatible/i, /capability.*not/i, /feature.*not/i,
];

const PAYLOAD_ERROR_PATTERNS = [
  /budget_tokens.*greater than or equal/i,
  /max_tokens.*must be/i,
  /temperature.*must be/i,
];

function looksUnsupported(_status: number, body: string): boolean {
  if (PAYLOAD_ERROR_PATTERNS.some((p) => p.test(body))) return false;
  return UNSUPPORTED_PATTERNS.some((p) => p.test(body));
}

export async function POST(req: NextRequest) {
  const guard = localhostGuard(req);
  if (guard) return guard;

  let body: TestCapBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ supported: false, detail: 'Invalid request body' });
  }

  const { capability, model, apiType = 'openai-compatible', thinkingBudget } = body;
  const apiKey = normalizeApiKeySecret(body.apiKey ?? '');
  if (!body.baseURL || !apiKey || !model) {
    return NextResponse.json({ supported: false, detail: 'Missing required fields' });
  }

  const baseUrl = normaliseBaseUrl(body.baseURL);
  if (!isUrlSafe(baseUrl)) {
    return NextResponse.json({ supported: false, detail: 'URL blocked by security policy' });
  }

  const effectiveBudget = capability === 'thinking'
    ? Math.max(Number(thinkingBudget) || 1024, 1024)
    : undefined;

  const profile = detectProviderProfile(baseUrl, apiType);
  const chatUrl = buildCapabilityProbeUrl(profile, baseUrl, model);
  const headers = buildCapabilityProbeHeaders(profile, apiKey, baseUrl);
  const requestBody = buildCapabilityProbePayload(profile, capability, model, effectiveBudget);

  // For vision / webSearch we use streaming with minimal tokens so the
  // upstream returns fast (first SSE chunk ≈ 200 OK is enough to confirm).
  // Exceptions:
  //  - thinking: needs non-streaming to inspect response body
  //  - anthropic profile: streaming triggers auto-thinking on newer Claude models
  //  - Claude models on ANY provider: proxy may forward streaming to Anthropic
  //    backend, triggering auto-thinking + budget_tokens validation failures
  const isClaude = isClaudeModel(model);
  const useStream = capability !== 'thinking' && profile !== 'anthropic' && !isClaude;
  if (useStream) {
    requestBody.stream = true;
    requestBody.max_tokens = 16;
  }

  const TIMEOUT_MS = 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    console.log('[test-capability] profile:', profile, 'capability:', capability,
      'model:', model, 'url:', chatUrl, 'stream:', useStream);

    // SU-ITER-089 · P1-4 — SSRF-safe fetch with manual redirect +
    // Location re-validation.
    const res = await safeUpstreamFetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      if (capability === 'thinking') {
        const data = await res.json().catch(() => null);
        const hasThinking = responseContainsThinking(data);
        return NextResponse.json({
          supported: true,
          detail: hasThinking
            ? 'Thinking content detected'
            : 'Request succeeded (model may support thinking)',
        });
      }
      // Streaming 200 → capability confirmed; abort to free the connection
      controller.abort();
      return NextResponse.json({ supported: true, detail: 'Capability supported' });
    }

    const errorText = await res.text().catch(() => '');
    const detail = errorText.slice(0, 300);

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        supported: 'unknown' as const,
        detail: `Auth error (HTTP ${res.status}): check API key`,
      });
    }

    if (res.status === 404) {
      return NextResponse.json({
        supported: false,
        detail: `Not supported (404): ${detail}`,
      });
    }

    if (looksUnsupported(res.status, detail)) {
      return NextResponse.json({
        supported: false,
        detail: `Not supported: ${detail}`,
      });
    }

    if (res.status === 429) {
      return NextResponse.json({
        supported: 'unknown' as const,
        detail: 'Rate limited — try again later',
      });
    }

    return NextResponse.json({
      supported: 'unknown' as const,
      detail: `HTTP ${res.status}: ${detail}`,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({
        supported: 'unknown' as const,
        detail: `Timed out (${TIMEOUT_MS / 1000}s)`,
      });
    }
    // SU-ITER-089 · P1-4 — report SSRF blocks as `unsupported` so the
    // UI renders the policy reason rather than a generic "unknown".
    if (err instanceof SafeUpstreamError) {
      return NextResponse.json({
        supported: false as const,
        detail: err.message,
      });
    }
    return NextResponse.json({
      supported: 'unknown' as const,
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
