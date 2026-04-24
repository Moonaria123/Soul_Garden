// ============================================================
// Upstream URL utilities — server-side only
// Builds model-list URLs & validates target safety (SSRF)
// Aligned with SRB `buildOpenAiCompatibleModelsListUrl` + `buildModelsProbeUrl` (anthropic)
// ============================================================

import type { ApiType } from '@/types';

/** Azure OpenAI / Azure AI Foundry REST `api-version` for models + chat (SU-ITER-030) */
export const AZURE_OPENAI_API_VERSION = '2024-10-21';

/**
 * Azure OpenAI hosts require `GET …/openai/models?api-version=…` and `api-key` header,
 * not OpenAI's `/v1/models` + Bearer — otherwise upstream returns 401.
 */
export function isAzureOpenAiHost(baseUrl: string): boolean {
  try {
    const h = new URL(baseUrl).hostname.toLowerCase();
    return (
      h.endsWith('.openai.azure.com') ||
      h.endsWith('.services.ai.azure.com')
    );
  } catch {
    return false;
  }
}

/**
 * List models on Azure OpenAI (classic resource hostname).
 */
export function buildAzureOpenAIModelsListUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const q = `api-version=${AZURE_OPENAI_API_VERSION}`;
  if (/\/openai\/?$/i.test(base)) {
    return `${base.replace(/\/$/, '')}/models?${q}`;
  }
  return `${base}/openai/models?${q}`;
}

/**
 * Chat completions on Azure (deployment id = model name in our UI).
 */
export function buildAzureOpenAiChatCompletionsUrl(baseUrl: string, deployment: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const enc = encodeURIComponent(deployment);
  const q = `api-version=${AZURE_OPENAI_API_VERSION}`;
  if (/\/openai\/?$/i.test(base)) {
    return `${base.replace(/\/$/, '')}/deployments/${enc}/chat/completions?${q}`;
  }
  return `${base}/openai/deployments/${enc}/chat/completions?${q}`;
}

/**
 * Probe URL for GET models list — **must** match chat proxy path rules:
 * if `baseUrl` already ends with `/v1`, append `/models` only (no double `/v1`).
 * Fixes 401/404 from wrong paths when users paste `…/v1` (SU-ITER-029).
 * Azure uses a separate path (`/openai/models`) + query (SU-ITER-030).
 */
export function buildModelsProbeUrl(baseUrl: string, apiType: ApiType): string {
  if (isAzureOpenAiHost(baseUrl)) {
    return buildAzureOpenAIModelsListUrl(baseUrl);
  }
  const base = baseUrl.replace(/\/+$/, '');
  if (apiType === 'anthropic') {
    if (base.endsWith('/v1')) {
      return `${base}/models`;
    }
    return `${base}/v1/models`;
  }
  return buildModelsListUrl(baseUrl);
}

/**
 * Build the OpenAI-compatible `/v1/models` endpoint URL.
 * Handles base URLs with or without a trailing `/v1`.
 *
 * @example
 * buildModelsListUrl("https://api.openai.com")        → "https://api.openai.com/v1/models"
 * buildModelsListUrl("https://api.openai.com/v1")     → "https://api.openai.com/v1/models"
 * buildModelsListUrl("https://api.openai.com/v1/")    → "https://api.openai.com/v1/models"
 */
export function buildModelsListUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/v1')) {
    return `${base}/models`;
  }
  return `${base}/v1/models`;
}

/**
 * OpenAI-compatible `POST …/chat/completions` (non-Azure).
 * Aligns with `llm-client` and `/api/llm/chat` OpenAI branch.
 */
export function buildOpenAiCompatibleChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

/**
 * Normalise a base URL for upstream requests:
 * - strip trailing slashes
 * - ensure it starts with http:// or https://
 */
export function normaliseBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url;
}

// Private IPs & reserved hostnames — block to prevent SSRF
const PRIVATE_IP_PATTERNS = [
  /^127\./,           // 127.0.0.0/8
  /^10\./,            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,      // 192.168.0.0/16
  /^0\./,             // 0.0.0.0/8
  /^169\.254\./,      // link-local
  /^::1$/,            // IPv6 loopback
  /^fc00:/i,          // IPv6 ULA
  /^fe80:/i,          // IPv6 link-local
];

const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
];

/**
 * Basic SSRF guard — rejects URLs pointing at private/internal networks.
 * **Exception**: `localhost` and `127.0.0.1` are ALLOWED because Soul Upload
 * users commonly run local inference servers (Ollama, LM Studio, etc.).
 *
 * @returns `true` if the URL is considered safe to fetch
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Allow localhost explicitly (local inference servers)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // Block cloud metadata endpoints
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return false;
    }

    // Block private IP ranges (except localhost already allowed above)
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return false;
      }
    }

    // Must be http or https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
