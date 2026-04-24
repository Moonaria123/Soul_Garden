'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { LLMProvider, ModelInfo, ModelConfig, ApiType } from '@/types';
import { translate } from '@/lib/i18n';
import { encrypt, decrypt } from '@/lib/crypto';
import { requireDEK } from '@/lib/crypto/reunlock';
import * as dbClient from '@/lib/db/db-client';
import { normalizeApiKeySecret } from '@/lib/llm/api-key';

// ============================================================
// Provider Store — Pure SQLite architecture via db-client.
// API key encryption still client-side (AES-256-GCM + DEK).
// ============================================================

interface ProviderState {
  providers: LLMProvider[];
  activeModelConfig: ModelConfig;
  isLoading: boolean;
  error: string | null;

  loadProviders: () => Promise<void>;
  addProvider: (opts: {
    name: string; baseURL: string; apiKey: string;
    apiType?: ApiType; enabled?: boolean;
  }) => Promise<LLMProvider>;
  updateProvider: (
    id: string,
    updates: Partial<Pick<LLMProvider, 'name' | 'baseURL' | 'apiType' | 'enabled' | 'models'>> & { apiKey?: string }
  ) => Promise<void>;
  /**
   * SU-ITER-094 · P0-1 — Persist a capability probe result back into
   * the provider's model definition so the badge + downstream clamp
   * survive a reload.  Updates both the structured `capabilities` map
   * and the legacy `supports*` mirror used by `modelToRow`.
   */
  setModelCapability: (
    providerId: string,
    modelApiId: string,
    capability: 'thinking' | 'vision' | 'webSearch',
    supported: boolean,
  ) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setDefaultProvider: (id: string) => Promise<void>;
  fetchModels: (baseURL: string, apiKey: string, apiType?: ApiType) => Promise<{ models: ModelInfo[]; listHint?: string }>;
  testConnection: (baseURL: string, apiKey: string, apiType?: ApiType) => Promise<{ ok: boolean; error?: string; hint?: string; detail?: string }>;
  getDecryptedApiKey: (provider: LLMProvider) => Promise<string>;
  syncModelsFromUpstream: (providerId: string) => Promise<{ count: number; error?: string; listHint?: string }>;
  setActiveModelConfig: (config: Partial<ModelConfig>) => Promise<void>;
  getActiveLLMOptions: () => Promise<{
    apiKey: string; baseURL: string; model: string; temperature: number;
    thinkingEnabled: boolean; thinkingDepth: ModelConfig['thinkingDepth'];
    thinkingBudget: number;
    visionEnabled: boolean; webSearchEnabled: boolean; apiType: ApiType;
  } | null>;
  clearError: () => void;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  modelId: '', providerId: '', temperature: 0.8,
  thinkingEnabled: false, thinkingDepth: 'off', thinkingBudget: 1024,
  visionEnabled: false, webSearchEnabled: false,
};

const MODEL_CONFIG_KEY = 'active-model-config';

// SU-ITER-091-batch2 · P3-06 — capability inference from model ids is
// an inherently fuzzy heuristic (providers rename SKUs aggressively and
// most OpenAI-compatible endpoints don't surface structured capability
// metadata).  The previous implementation string-matched inside an ad
// hoc boolean chain that silently mis-triaged things like `text-o1-ada`
// (not a reasoning model!) or a chat-only `claude-3-haiku` (not
// vision).  We harden the matcher by:
//
//   1. Switching to word-boundary-anchored regexes so substrings inside
//      larger identifiers don't trigger false positives.
//   2. Adding known negative lookaheads (e.g. `-3-haiku` stays
//      non-vision).
//   3. Normalising the model id with the shared `normaliseModelId`
//      helper (strip version suffixes / date stamps) before matching.
//   4. Keeping the rules declarative so security-reviewer can audit
//      them without re-reading the dispatch chain.
//
// The function still returns a best-effort inference — the UI allows
// the user to override per-model flags manually.
// RLX-ESL-02 (SU-092-batch1): model-id fingerprints — anchored \b, fixed
// alternation groups, non-nested quantifiers, matched against short model
// IDs (always <128 chars).  safe-regex flags any `(?:…)?(?:…)?` sequence as
// "ambiguous" but cannot distinguish between nested and sequential optional
// groups in practice.
/* eslint-disable security/detect-unsafe-regex */
const VISION_MATCHERS: RegExp[] = [
  /\bvision\b/,
  /\bgpt-4o\b/,
  /\bgpt-4\.1\b/,
  /\bgpt-4-turbo\b/,
  /\bgpt-5\b/,
  /\bclaude-3(?:\.[0-9]+)?-(?:opus|sonnet)\b/,
  /\bclaude-4\b/,
  /\bgemini(?:-pro)?(?:-1\.5|-2)?\b/,
  /\bqwen2?-vl\b/,
];

const THINKING_MATCHERS: RegExp[] = [
  /\bo1(?:-\w+)?\b/,
  /\bo3(?:-\w+)?\b/,
  /\bo4(?:-\w+)?\b/,
  /\bthinking\b/,
  /\breasoning\b/,
  /\bdeepseek-r\d*\b/,
  /\bqwen-?qwq\b/,
];

const WEB_SEARCH_MATCHERS: RegExp[] = [
  /\bsearch\b/,
  /\bonline\b/,
  /\bpplx\b/,
  /\bsonar\b/,
];

const WEB_SEARCH_URL_MATCHERS: RegExp[] = [/\bperplexity\b/];
/* eslint-enable security/detect-unsafe-regex */

function normaliseModelId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^models\//, '')
    .replace(/[_/]/g, '-')
    .replace(/-(\d{6,8})$/, '');
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  for (const rx of patterns) {
    if (rx.test(value)) return true;
  }
  return false;
}

function inferCapabilities(modelId: string, providerBaseURL?: string) {
  const id = normaliseModelId(modelId);
  const url = (providerBaseURL || '').toLowerCase();
  return {
    vision: matchesAny(id, VISION_MATCHERS),
    thinking: matchesAny(id, THINKING_MATCHERS),
    webSearch:
      matchesAny(id, WEB_SEARCH_MATCHERS) ||
      matchesAny(url, WEB_SEARCH_URL_MATCHERS),
  };
}

// Wire layer returns drizzle `$inferSelect` objects (camelCase);
// snake_case fallbacks are retained defensively.
function providerRowToLocal(
  row: Record<string, unknown>,
  models: ModelInfo[],
): LLMProvider {
  return {
    id: row.id as string,
    name: row.name as string,
    baseURL: (row.baseUrl ?? row.base_url) as string,
    apiType: ((row.apiType ?? row.api_type ?? 'openai-compatible') as ApiType),
    encryptedApiKey: (row.encryptedApiKey ?? row.encrypted_api_key ?? '') as string,
    apiKeyIV: (row.apiKeyIV ?? row.api_key_iv ?? '') as string,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : row.enabled !== 0,
    isDefault: typeof row.isDefault === 'boolean' ? row.isDefault : row.is_default !== 0,
    models,
    createdAt: (row.createdAt ?? row.created_at) as string,
    updatedAt: (row.updatedAt ?? row.updated_at) as string,
  };
}

function modelRowToLocal(row: Record<string, unknown>): ModelInfo {
  const sv = typeof row.supportsVision === 'boolean'
    ? row.supportsVision
    : ((row.supports_vision as boolean | undefined) ?? false);
  const st = typeof row.supportsThinking === 'boolean'
    ? row.supportsThinking
    : ((row.supports_thinking as boolean | undefined) ?? false);
  const sw = typeof row.supportsWebSearch === 'boolean'
    ? row.supportsWebSearch
    : ((row.supports_web_search as boolean | undefined) ?? false);
  // Use `name` (the original model API name) as the ID — the storage `id`
  // is a composite key (`providerId::modelId`) to prevent cross-provider collisions.
  const modelApiId = (row.name ?? row.id) as string;
  return {
    id: modelApiId,
    name: ((row.displayName ?? row.display_name ?? modelApiId) as string),
    alias: row.alias as string | undefined,
    contextWindow: (row.contextWindow ?? row.context_window) as number | undefined,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : row.enabled !== 0,
    supportsThinking: st, supportsVision: sv, supportsWebSearch: sw,
    capabilities: { text: true, vision: sv, thinking: st, webSearch: sw },
  };
}

function modelStorageId(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function modelToRow(model: ModelInfo, providerId: string) {
  return {
    id: modelStorageId(providerId, model.id), providerId, name: model.id,
    displayName: model.name ?? null, alias: model.alias ?? null,
    contextWindow: model.contextWindow ?? null, isCustom: false,
    enabled: model.enabled ?? true,
    supportsThinking: model.supportsThinking ?? model.capabilities?.thinking ?? false,
    supportsVision: model.supportsVision ?? model.capabilities?.vision ?? false,
    supportsWebSearch: model.supportsWebSearch ?? model.capabilities?.webSearch ?? false,
    capabilitiesText: model.capabilities?.text ?? true,
  };
}

function providerToRow(p: LLMProvider) {
  return {
    id: p.id, name: p.name, apiType: p.apiType, baseUrl: p.baseURL,
    encryptedApiKey: p.encryptedApiKey, apiKeyIV: p.apiKeyIV,
    isDefault: p.isDefault, enabled: p.enabled,
  };
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  activeModelConfig: { ...DEFAULT_MODEL_CONFIG },
  isLoading: false,
  error: null,

  loadProviders: async () => {
    set({ isLoading: true });
    try {
      // SU-ITER-090c · P2-07 — collapsed former 1 + N queries (one
      // `listProviders` + one `listModels` per provider row) into a
      // single `listProvidersWithModels` batch call.  On a user with 5+
      // configured providers this brings settings-page hydration from
      // N+1 network hops down to a constant 2 (providers + config).
      const bundled = await dbClient.listProvidersWithModels();
      const providers: LLMProvider[] = bundled.map(({ provider, models }) =>
        providerRowToLocal(
          provider as unknown as Record<string, unknown>,
          models.map((m) => modelRowToLocal(m as unknown as Record<string, unknown>)),
        ),
      );

      let config = { ...DEFAULT_MODEL_CONFIG };
      try {
        const saved = await dbClient.getConfig(MODEL_CONFIG_KEY);
        if (saved?.value) config = { ...DEFAULT_MODEL_CONFIG, ...JSON.parse(saved.value) };
      } catch { /* first load */ }

      const defaultProvider = providers.find((p) => p.id === config.providerId) || providers.find((p) => p.isDefault) || providers[0];
      if (defaultProvider) {
        if (config.providerId !== defaultProvider.id) { config.providerId = defaultProvider.id; config.modelId = defaultProvider.models[0]?.id || ''; }
        else if (config.modelId && !defaultProvider.models.some((m) => m.id === config.modelId)) { config.modelId = defaultProvider.models[0]?.id || ''; }
      }

      set({ providers, activeModelConfig: config, isLoading: false });
    } catch { set({ providers: [], isLoading: false }); }
  },

  addProvider: async ({ name, baseURL, apiKey, apiType = 'openai-compatible', enabled = true }) => {
    const dek = await requireDEK();
    const keyPlain = normalizeApiKeySecret(apiKey);
    if (!keyPlain) throw new Error('EMPTY_API_KEY');
    const encResult = await encrypt(keyPlain, dek);

    const provider: LLMProvider = {
      id: uuid(), name, baseURL: baseURL.replace(/\/+$/, ''),
      encryptedApiKey: encResult.ciphertext, apiKeyIV: encResult.iv,
      apiType, enabled, models: [],
      isDefault: get().providers.length === 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };

    try {
      await dbClient.upsertProvider(providerToRow(provider));
    } catch (e) { console.error('Failed to add provider:', e); throw e; }
    set({ providers: [...get().providers, provider] });
    return provider;
  },

  updateProvider: async (id, updates) => {
    const dek = await requireDEK();
    const existing = get().providers.find((p) => p.id === id);
    if (!existing) return;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    if (updates.baseURL !== undefined) updated.baseURL = updates.baseURL.trim().replace(/\/+$/, '');
    if (updates.apiKey) {
      const keyPlain = normalizeApiKeySecret(updates.apiKey);
      if (keyPlain) { const encResult = await encrypt(keyPlain, dek); updated.encryptedApiKey = encResult.ciphertext; updated.apiKeyIV = encResult.iv; }
    }
    delete (updated as Record<string, unknown>).apiKey;

    try {
      await dbClient.upsertProvider(providerToRow(updated));
      if (updates.models) {
        await dbClient.deleteModelsForProvider(id);
        for (const m of updates.models) await dbClient.upsertModel(modelToRow(m, id));
      }
    } catch (e) { console.error('Failed to update provider:', e); throw e; }
    set({ providers: get().providers.map((p) => (p.id === id ? updated : p)) });
  },

  // SU-ITER-094 · P0-1 — capability probe writeback.  Mutates only the
  // targeted model row (by its upstream-visible id) so concurrent
  // probes on sibling capabilities don't race each other's state.
  setModelCapability: async (providerId, modelApiId, capability, supported) => {
    const existing = get().providers.find((p) => p.id === providerId);
    if (!existing) return;
    const modelIdx = existing.models.findIndex((m) => m.id === modelApiId);
    if (modelIdx < 0) return;

    const prevModel = existing.models[modelIdx];
    const nextCaps = { ...(prevModel.capabilities ?? { text: true, vision: false, thinking: false, webSearch: false }) };
    const supportsKey =
      capability === 'thinking' ? 'supportsThinking'
      : capability === 'vision' ? 'supportsVision'
      : 'supportsWebSearch';
    nextCaps[capability] = supported;
    const nextModel: ModelInfo = {
      ...prevModel,
      capabilities: nextCaps,
      [supportsKey]: supported,
    };
    const nextModels = [...existing.models];
    nextModels[modelIdx] = nextModel;
    const nextProvider: LLMProvider = {
      ...existing,
      models: nextModels,
      updatedAt: new Date().toISOString(),
    };

    try {
      await dbClient.upsertModel(modelToRow(nextModel, providerId));
    } catch (e) {
      console.error('Failed to persist capability:', e);
      throw e;
    }
    set({
      providers: get().providers.map((p) => (p.id === providerId ? nextProvider : p)),
    });
  },

  deleteProvider: async (id) => {
    try {
      await dbClient.deleteProvider(id);
      const remaining = get().providers.filter((p) => p.id !== id);
      if (remaining.length > 0 && !remaining.some((p) => p.isDefault)) {
        remaining[0].isDefault = true;
        await dbClient.upsertProvider(providerToRow(remaining[0]));
      }
      set({ providers: remaining });
    } catch (e) { console.error('Failed to delete provider:', e); throw e; }
  },

  // SU-ITER-092-batch3 · A3-MEDIUM-02 — server-side single-statement
  // flip (see `storage-service.setDefaultProvider` + `db-client.
  // setDefaultProvider`) replaces the previous per-row `upsertProvider`
  // fanout.  The local state update stays client-side so the UI still
  // reflects the change synchronously after the single HTTP call.
  setDefaultProvider: async (id) => {
    await dbClient.setDefaultProvider(id);
    const now = new Date().toISOString();
    const updated = get().providers.map((p) =>
      p.isDefault === (p.id === id)
        ? p
        : { ...p, isDefault: p.id === id, updatedAt: now },
    );
    set({ providers: updated });
  },

  fetchModels: async (baseURL, apiKey, apiType = 'openai-compatible') => {
    const res = await fetch('/api/llm/upstream-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseURL, apiKey, apiType }) });
    const data = await res.json();
    if (data.error) { const detail = typeof data.detail === 'string' ? ` (${data.detail})` : ''; throw new Error(`${data.error}${detail}`); }
    const listHint = typeof data.hintCode === 'string' ? translate(data.hintCode) : undefined;
    const models: ModelInfo[] = (data.models || []).map((m: { id: string; owned_by?: string }) => {
      const caps = inferCapabilities(m.id, baseURL);
      return { id: m.id, name: m.owned_by, enabled: true, supportsVision: caps.vision, supportsThinking: caps.thinking, supportsWebSearch: caps.webSearch, capabilities: { text: true, vision: caps.vision, thinking: caps.thinking, webSearch: caps.webSearch } };
    });
    return { models, listHint };
  },

  testConnection: async (baseURL, apiKey, apiType = 'openai-compatible') => {
    try {
      const res = await fetch('/api/llm/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseURL, apiKey, apiType }) });
      const data = await res.json();
      if (data.success) return { ok: true, hint: typeof data.hintCode === 'string' ? translate(data.hintCode) : undefined };
      const parts: string[] = [];
      if (typeof data.detail === 'string') parts.push(data.detail);
      if (typeof data.probeUrl === 'string') parts.push(`URL: ${data.probeUrl}`);
      return { ok: false, error: data.message || translate('settings.connectionFailed'), detail: parts.length > 0 ? parts.join(' | ') : undefined };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : translate('settings.connectionFailed') }; }
  },

  syncModelsFromUpstream: async (providerId) => {
    const provider = get().providers.find((p) => p.id === providerId);
    if (!provider) return { count: 0, error: 'Provider not found' };
    try {
      const apiKey = await get().getDecryptedApiKey(provider);
      const { models: upstreamModels, listHint } = await get().fetchModels(provider.baseURL, apiKey, provider.apiType);
      await get().updateProvider(providerId, { models: upstreamModels });
      return { count: upstreamModels.length, listHint };
    } catch (e) { return { count: 0, error: e instanceof Error ? e.message : 'Sync failed' }; }
  },

  getDecryptedApiKey: async (provider) => {
    const dek = await requireDEK();
    const raw = await decrypt({ ciphertext: provider.encryptedApiKey, iv: provider.apiKeyIV }, dek);
    return normalizeApiKeySecret(raw);
  },

  setActiveModelConfig: async (updates) => {
    const config = { ...get().activeModelConfig, ...updates };
    set({ activeModelConfig: config });
    await dbClient.setConfig(MODEL_CONFIG_KEY, JSON.stringify(config)).catch((e) => console.warn('Failed to persist model config:', e));
  },

  getActiveLLMOptions: async () => {
    const { providers, activeModelConfig } = get();
    const provider = providers.find((p) => p.id === activeModelConfig.providerId) || providers.find((p) => p.isDefault) || providers[0];
    if (!provider) return null;
    const apiKey = await get().getDecryptedApiKey(provider);
    return {
      apiKey, baseURL: provider.baseURL,
      model: activeModelConfig.modelId || provider.models[0]?.id || 'gpt-4o-mini',
      temperature: activeModelConfig.temperature, thinkingEnabled: activeModelConfig.thinkingEnabled,
      // SU-ITER-093 — forward depth + budget so the proxy can emit
      // provider-correct fields (`reasoning_effort`,
      // `thinking.budget_tokens`, `thinking_budget`).
      thinkingDepth: activeModelConfig.thinkingDepth ?? 'off',
      thinkingBudget: activeModelConfig.thinkingBudget ?? 1024,
      visionEnabled: activeModelConfig.visionEnabled ?? false, webSearchEnabled: activeModelConfig.webSearchEnabled ?? false,
      apiType: provider.apiType ?? 'openai-compatible',
    };
  },

  clearError: () => set({ error: null }),
}));
