// ============================================================
// Provider-aware capability probe profiles (SU-ITER-084)
//
// Maps vendor × capability to the correct request payload,
// URL, and headers — prevents cross-vendor field contamination.
// ============================================================

import type { ApiType } from '@/types';
import {
  isAzureOpenAiHost,
  buildAzureOpenAiChatCompletionsUrl,
  buildOpenAiCompatibleChatCompletionsUrl,
} from '@/lib/llm/upstream-url';

// -- Provider profiles -------------------------------------------------------

export type ProviderProfile =
  | 'openai'
  | 'azure-openai'
  | 'anthropic'
  | 'dashscope'
  | 'generic-openai-compatible';

/**
 * Detect the provider profile from baseURL + apiType.
 *
 * Priority:
 *  1. apiType === 'anthropic'
 *  2. Azure hostname
 *  3. DashScope hostname (any subdomain of `*.aliyuncs.com` containing 'dashscope')
 *  4. OpenAI hostname (`api.openai.com`)
 *  5. Fallback: generic OpenAI-compatible
 */
export function detectProviderProfile(
  baseUrl: string,
  apiType: ApiType,
): ProviderProfile {
  if (apiType === 'anthropic') return 'anthropic';

  let hostname = '';
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'generic-openai-compatible';
  }

  if (isAzureOpenAiHost(baseUrl)) return 'azure-openai';
  if (hostname.endsWith('.anthropic.com') || hostname.endsWith('.claude.ai')) return 'anthropic';
  if (hostname.includes('dashscope') && hostname.endsWith('.aliyuncs.com')) return 'dashscope';
  if (hostname.endsWith('.aliyuncs.com')) return 'dashscope';
  if (hostname === 'api.openai.com') return 'openai';

  return 'generic-openai-compatible';
}

// -- Test image assets -------------------------------------------------------

// 8×8 red PNG for providers that accept base64 data URIs reliably
const TEST_IMAGE_8X8_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12P4z8BQDwAEgAF/' +
  'QualDwAAAABJRU5ErkJggg==';

// Public URL used for DashScope vision probes — DashScope handles URL images
// more reliably than tiny base64 data URIs
const TEST_IMAGE_URL =
  'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg';

function testImageBase64(): string {
  return TEST_IMAGE_8X8_PNG.split(',')[1];
}

// -- Chat URL builder --------------------------------------------------------

export function buildCapabilityProbeUrl(
  profile: ProviderProfile,
  baseUrl: string,
  model: string,
): string {
  if (profile === 'anthropic') {
    const base = baseUrl.replace(/\/+$/, '');
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  }
  if (profile === 'azure-openai') {
    return buildAzureOpenAiChatCompletionsUrl(baseUrl, model);
  }
  return buildOpenAiCompatibleChatCompletionsUrl(baseUrl);
}

// -- Headers builder ---------------------------------------------------------

export function buildCapabilityProbeHeaders(
  profile: ProviderProfile,
  apiKey: string,
  _baseUrl: string,
): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };

  switch (profile) {
    case 'anthropic':
      h['x-api-key'] = apiKey;
      h['anthropic-version'] = '2023-06-01';
      break;
    case 'azure-openai':
      h['api-key'] = apiKey;
      break;
    default:
      h['Authorization'] = `Bearer ${apiKey}`;
      break;
  }

  return h;
}

// -- Payload builders (profile × capability) ---------------------------------

export function buildCapabilityProbePayload(
  profile: ProviderProfile,
  capability: 'thinking' | 'vision' | 'webSearch',
  model: string,
  thinkingBudget?: number,
): Record<string, unknown> {
  switch (profile) {
    case 'anthropic':
      return buildAnthropicPayload(capability, model, thinkingBudget);
    case 'dashscope':
      return buildDashScopePayload(capability, model, thinkingBudget);
    case 'openai':
    case 'azure-openai':
      return buildOpenAiPayload(capability, model);
    default:
      return buildGenericPayload(capability, model, thinkingBudget);
  }
}

// -- Model-name detection helpers --------------------------------------------

/**
 * Detect whether a model is a Claude model by its ID/name, regardless of which
 * provider (Anthropic, Poe, OpenRouter, etc.) is hosting it.
 */
export function isClaudeModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('claude')
    || /\b(opus|sonnet|haiku)\b/.test(m);
}

function isAdaptiveModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('opus-4-6') || m.includes('sonnet-4-6')
    || m.includes('opus-4.6') || m.includes('sonnet-4.6')
    || m.includes('mythos');
}

// -- Anthropic ---------------------------------------------------------------

function buildAnthropicPayload(
  capability: 'thinking' | 'vision' | 'webSearch',
  model: string,
  thinkingBudget?: number,
): Record<string, unknown> {
  // For non-thinking probes: OMIT the thinking field entirely.
  // Sending `thinking: {type: "disabled"}` still triggers budget_tokens
  // validation on newer models; omitting it avoids the validation pipeline.
  // max_tokens must be high (>= 1024) so the internal default budget check passes.
  const base: Record<string, unknown> = { model, max_tokens: 4096 };

  if (capability === 'thinking') {
    if (isAdaptiveModel(model)) {
      base.thinking = { type: 'adaptive' };
    } else {
      const budget = Math.max(thinkingBudget ?? 1024, 1024);
      base.thinking = { type: 'enabled', budget_tokens: budget };
      base.max_tokens = budget + 1024;
    }
    base.messages = [{ role: 'user', content: 'Say hi.' }];
  } else if (capability === 'vision') {
    base.messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: testImageBase64() } },
        { type: 'text', text: 'Describe this image in one word.' },
      ],
    }];
  } else {
    base.messages = [{ role: 'user', content: 'What is today?' }];
    base.tools = [{ type: 'web_search_20250305' }];
  }

  return base;
}

// -- DashScope (Alibaba Cloud Model Studio) ----------------------------------
// Docs: enable_search (top-level), enable_thinking (top-level)
// Must NOT send web_search_options or reasoning_effort.

function buildDashScopePayload(
  capability: 'thinking' | 'vision' | 'webSearch',
  model: string,
  thinkingBudget?: number,
): Record<string, unknown> {
  const base: Record<string, unknown> = { model, max_tokens: 10 };

  if (capability === 'thinking') {
    base.messages = [{ role: 'user', content: 'Say hi.' }];
    base.enable_thinking = true;
    if (thinkingBudget && thinkingBudget > 0) {
      base.thinking_budget = thinkingBudget;
    }
    base.max_tokens = 200;
  } else if (capability === 'vision') {
    base.messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: TEST_IMAGE_URL } },
        { type: 'text', text: 'What?' },
      ],
    }];
  } else {
    base.messages = [{ role: 'user', content: '今天天气' }];
    base.enable_search = true;
  }

  return base;
}

// -- OpenAI / Azure OpenAI ---------------------------------------------------

function buildOpenAiPayload(
  capability: 'thinking' | 'vision' | 'webSearch',
  model: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = { model, max_tokens: 50, stream: false };

  if (capability === 'thinking') {
    base.messages = [{ role: 'user', content: 'Say hi.' }];
    base.reasoning_effort = 'low';
  } else if (capability === 'vision') {
    base.messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: TEST_IMAGE_8X8_PNG } },
        { type: 'text', text: 'Describe this image in one word.' },
      ],
    }];
  } else {
    base.messages = [{ role: 'user', content: 'What is the weather today?' }];
    base.web_search_options = { search_context_size: 'low' };
  }

  return base;
}

// -- Generic OpenAI-compatible (best-effort, both fields) --------------------
//
// Claude models behind proxies (Poe, OpenRouter, etc.) still enforce
// Anthropic's thinking / budget_tokens validation.  We must:
//   - NOT send `reasoning_effort` (OpenAI-only; proxies may translate it into
//     Anthropic's thinking param with an invalid budget)
//   - Use high max_tokens (>= 1024) so Anthropic's internal default budget
//     check passes even if the proxy auto-enables thinking
//   - NOT stream (streaming can trigger auto-thinking on newer Claude models)
//   - NOT send `web_search_options` (OpenAI-only; Claude ignores / rejects it)

function buildGenericPayload(
  capability: 'thinking' | 'vision' | 'webSearch',
  model: string,
  _thinkingBudget?: number,
): Record<string, unknown> {
  const claude = isClaudeModel(model);
  const base: Record<string, unknown> = {
    model,
    max_tokens: claude ? 4096 : 50,
    stream: false,
  };

  if (capability === 'thinking') {
    base.messages = [{ role: 'user', content: 'Say hi.' }];
    if (!claude) {
      base.reasoning_effort = 'low';
    }
  } else if (capability === 'vision') {
    base.messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: TEST_IMAGE_8X8_PNG } },
        { type: 'text', text: 'Describe this image in one word.' },
      ],
    }];
  } else {
    base.messages = [{ role: 'user', content: 'What is the weather today?' }];
    if (!claude) {
      base.web_search_options = { search_context_size: 'low' };
    }
    base.enable_search = true;
  }

  return base;
}

// -- Thinking response heuristic ---------------------------------------------

const THINKING_INDICATORS = ['thinking', 'reasoning', 'reasoning_content'];

/**
 * Check whether the upstream response body contains evidence of
 * thinking/reasoning output — covers OpenAI, Anthropic, and
 * DashScope (`reasoning_content`) variants.
 */
export function responseContainsThinking(data: unknown): boolean {
  const text = JSON.stringify(data);
  return THINKING_INDICATORS.some((k) => text.includes(k));
}
