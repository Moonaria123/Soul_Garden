// ============================================================
// OpenAI 兼容供应商 — 普适策略（非仅某一云厂商）
// 许多网关不提供或限制 GET /v1/models，但对 POST …/chat/completions 仍按 Bearer 鉴权。
// 当列表接口返回 401/403/404/405 时，用最小 POST chat 区分「鉴权失败」与「仅列表不可用」。
// ============================================================

import type { ApiType } from '@/types';
import { buildOpenAiCompatibleChatCompletionsUrl, isAzureOpenAiHost } from '@/lib/llm/upstream-url';
import { safeUpstreamFetch } from '@/lib/security/safe-upstream-fetch';

/** i18n key — 列表拉取不可用，请在模型管理手填 modelId */
export const OPENAI_COMPAT_NO_MODELS_HINT_CODE =
  'settings.openaiCompatible.noModelsList' as const;

export function isOpenAiLikeApiType(apiType: ApiType): boolean {
  return apiType === 'openai' || apiType === 'openai-compatible';
}

/**
 * 对「OpenAI / OpenAI 兼容」且非 Azure 的 Base 启用列表失败时的二次探测与软成功提示。
 * Azure 使用独立 URL 与 `api-key` 头，不在此列。
 */
export function shouldUseOpenAiCompatibleModelsFallback(
  baseUrl: string,
  apiType: ApiType
): boolean {
  return isOpenAiLikeApiType(apiType) && !isAzureOpenAiHost(baseUrl);
}

export interface ChatProbeResult {
  authOk: boolean;
  status: number;
  body: string;
  url: string;
}

/**
 * 最小 POST chat 验证鉴权。
 *
 * 策略：用极短 max_tokens=1 + stream=false 发一个最小请求。
 * model 使用 'gpt-3.5-turbo'——即使供应商不提供该模型，
 * 大多数网关会在鉴权通过后才检查 model，返回 400/404 而非 401/403。
 * 若返回 401/403 则确认密钥无效；其余状态码均视为「鉴权通过」。
 */
export async function probeOpenAiCompatibleChatAuth(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal
): Promise<ChatProbeResult> {
  const url = buildOpenAiCompatibleChatCompletionsUrl(baseUrl);
  // SU-ITER-089 · P1-4 — route through the SSRF-safe helper so a
  // redirect to an internal host is blocked consistently with the
  // caller's own isUrlSafe check.
  const res = await safeUpstreamFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: '.' }],
      max_tokens: 1,
      stream: false,
    }),
    signal,
  });
  const body = await res.text().catch(() => '');
  const authOk = res.status !== 401 && res.status !== 403;
  return { authOk, status: res.status, body: body.slice(0, 500), url };
}
