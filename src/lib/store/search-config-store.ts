'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  ActiveSearchTool, SearchToolType, SearchToolConfig,
  WebSearchWhitelistCategory, WebSearchSettings,
} from '@/types';
import { encrypt, decrypt } from '@/lib/crypto';
import { requireDEK } from '@/lib/crypto/reunlock';
import * as dbClient from '@/lib/db/db-client';
import { normalizeApiKeySecret } from '@/lib/llm/api-key';

// ============================================================
// Search Config Store — Pure SQLite architecture via db-client.
// Config stored as JSON blob in app_config table.
// ============================================================

const SEARCH_CONFIG_KEY = 'search-config';

// SU-ITER-094 · Phase-B — tool-loop iteration bounds.  Exposed here (not
// baked into the route) so the settings UI and server share one source
// of truth.  Range matches the slider in the Network Search Tool panel.
export const DEFAULT_MAX_TOOL_ITERATIONS = 3;
export const MIN_TOOL_ITERATIONS = 1;
export const MAX_TOOL_ITERATIONS = 10;

function clampIterations(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_TOOL_ITERATIONS;
  return Math.min(MAX_TOOL_ITERATIONS, Math.max(MIN_TOOL_ITERATIONS, Math.trunc(v)));
}

const DEFAULT_FICTIONAL_SUMMON_WHITELIST: string[] = [
  'fandom.com', 'moegirlpedia.org', 'en.wikipedia.org', 'zh.wikipedia.org',
  'tvtropes.org', 'myanimelist.net', 'anilist.co', 'bangumi.tv', 'igdb.com', 'knowyourmeme.com',
];

interface SearchConfigState {
  activeTool: ActiveSearchTool;
  toolConfigs: SearchToolConfig[];
  whitelists: Record<WebSearchWhitelistCategory, string[]>;
  maxToolIterations: number;
  isLoaded: boolean;
  loadConfig: () => Promise<void>;
  setActiveTool: (tool: ActiveSearchTool) => Promise<void>;
  addToolConfig: (opts: { type: SearchToolType; name: string; apiKey: string; baseURL?: string }) => Promise<SearchToolConfig>;
  updateToolConfig: (id: string, updates: Partial<Pick<SearchToolConfig, 'name' | 'baseURL' | 'enabled'>> & { apiKey?: string }) => Promise<void>;
  deleteToolConfig: (id: string) => Promise<void>;
  getDecryptedApiKey: (config: SearchToolConfig) => Promise<string>;
  addWhitelistUrl: (category: WebSearchWhitelistCategory, url: string) => Promise<void>;
  removeWhitelistUrl: (category: WebSearchWhitelistCategory, url: string) => Promise<void>;
  setWhitelist: (category: WebSearchWhitelistCategory, urls: string[]) => Promise<void>;
  setMaxToolIterations: (value: number) => Promise<void>;
  getSettings: () => WebSearchSettings;
}

async function persistConfig(state: { activeTool: ActiveSearchTool; toolConfigs: SearchToolConfig[]; whitelists: Record<WebSearchWhitelistCategory, string[]>; maxToolIterations: number }) {
  await dbClient.setConfig(SEARCH_CONFIG_KEY, JSON.stringify(state)).catch((e) => console.warn('Failed to persist search config:', e));
}

export const useSearchConfigStore = create<SearchConfigState>((set, get) => ({
  activeTool: 'llm-native',
  toolConfigs: [],
  whitelists: { fictionalSummon: [...DEFAULT_FICTIONAL_SUMMON_WHITELIST], worldEye: [] },
  maxToolIterations: DEFAULT_MAX_TOOL_ITERATIONS,
  isLoaded: false,

  loadConfig: async () => {
    try {
      const row = await dbClient.getConfig(SEARCH_CONFIG_KEY);
      if (row?.value) {
        const saved = JSON.parse(row.value);
        set({
          activeTool: saved.activeTool || 'llm-native',
          toolConfigs: saved.toolConfigs || [],
          whitelists: { fictionalSummon: saved.whitelists?.fictionalSummon ?? [...DEFAULT_FICTIONAL_SUMMON_WHITELIST], worldEye: saved.whitelists?.worldEye ?? [] },
          maxToolIterations: clampIterations(saved.maxToolIterations),
          isLoaded: true,
        });
      } else { set({ isLoaded: true }); }
    } catch { set({ isLoaded: true }); }
  },

  setActiveTool: async (tool) => { set({ activeTool: tool }); await persistConfig({ activeTool: tool, toolConfigs: get().toolConfigs, whitelists: get().whitelists, maxToolIterations: get().maxToolIterations }); },

  addToolConfig: async ({ type, name, apiKey, baseURL }) => {
    const dek = await requireDEK();
    const keyPlain = normalizeApiKeySecret(apiKey);
    if (!keyPlain) throw new Error('EMPTY_API_KEY');
    const encResult = await encrypt(keyPlain, dek);
    const config: SearchToolConfig = {
      id: uuid(), type, name, encryptedApiKey: encResult.ciphertext, apiKeyIV: encResult.iv,
      baseURL: baseURL?.replace(/\/+$/, ''), enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const toolConfigs = [...get().toolConfigs, config];
    set({ toolConfigs });
    await persistConfig({ activeTool: get().activeTool, toolConfigs, whitelists: get().whitelists, maxToolIterations: get().maxToolIterations });
    return config;
  },

  updateToolConfig: async (id, updates) => {
    const dek = await requireDEK();
    const existing = get().toolConfigs.find((c) => c.id === id);
    if (!existing) return;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    if (updates.baseURL !== undefined) updated.baseURL = updates.baseURL.trim().replace(/\/+$/, '');
    if (updates.apiKey) { const keyPlain = normalizeApiKeySecret(updates.apiKey); if (keyPlain) { const encResult = await encrypt(keyPlain, dek); updated.encryptedApiKey = encResult.ciphertext; updated.apiKeyIV = encResult.iv; } }
    delete (updated as Record<string, unknown>).apiKey;
    const toolConfigs = get().toolConfigs.map((c) => (c.id === id ? updated : c));
    set({ toolConfigs });
    await persistConfig({ activeTool: get().activeTool, toolConfigs, whitelists: get().whitelists, maxToolIterations: get().maxToolIterations });
  },

  deleteToolConfig: async (id) => {
    const toolConfigs = get().toolConfigs.filter((c) => c.id !== id);
    const deletedConfig = get().toolConfigs.find((c) => c.id === id);
    let { activeTool } = get();
    if (deletedConfig && activeTool === deletedConfig.type) activeTool = 'llm-native';
    set({ toolConfigs, activeTool });
    await persistConfig({ activeTool, toolConfigs, whitelists: get().whitelists, maxToolIterations: get().maxToolIterations });
  },

  getDecryptedApiKey: async (config) => {
    const dek = await requireDEK();
    const raw = await decrypt({ ciphertext: config.encryptedApiKey, iv: config.apiKeyIV }, dek);
    return normalizeApiKeySecret(raw);
  },

  addWhitelistUrl: async (category, url) => {
    const whitelists = { ...get().whitelists };
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed || whitelists[category].includes(trimmed)) return;
    whitelists[category] = [...whitelists[category], trimmed];
    set({ whitelists });
    await persistConfig({ activeTool: get().activeTool, toolConfigs: get().toolConfigs, whitelists, maxToolIterations: get().maxToolIterations });
  },

  removeWhitelistUrl: async (category, url) => {
    const whitelists = { ...get().whitelists };
    whitelists[category] = whitelists[category].filter((u) => u !== url);
    set({ whitelists });
    await persistConfig({ activeTool: get().activeTool, toolConfigs: get().toolConfigs, whitelists, maxToolIterations: get().maxToolIterations });
  },

  setWhitelist: async (category, urls) => {
    const whitelists = { ...get().whitelists, [category]: urls };
    set({ whitelists });
    await persistConfig({ activeTool: get().activeTool, toolConfigs: get().toolConfigs, whitelists, maxToolIterations: get().maxToolIterations });
  },

  setMaxToolIterations: async (value) => {
    const maxToolIterations = clampIterations(value);
    set({ maxToolIterations });
    await persistConfig({ activeTool: get().activeTool, toolConfigs: get().toolConfigs, whitelists: get().whitelists, maxToolIterations });
  },

  getSettings: () => { const { activeTool, toolConfigs, whitelists, maxToolIterations } = get(); return { activeTool, toolConfigs, whitelists, maxToolIterations }; },
}));
