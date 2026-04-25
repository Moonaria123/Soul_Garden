'use client';

import { create } from 'zustand';
import { encrypt, decrypt } from '@/lib/crypto';
import { requireDEK } from '@/lib/crypto/reunlock';
import * as dbClient from '@/lib/db/db-client';
import { normalizeApiKeySecret } from '@/lib/llm/api-key';
import {
  ALLOWED_LOCAL_EMBEDDING_MODEL_IDS,
  ALLOWED_LOCAL_WEIGHT_SOURCES,
  DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
  DEFAULT_LOCAL_WEIGHT_SOURCE,
  type LocalWeightSource,
  buildCloudEmbeddingModelKey,
  buildLocalEmbeddingModelKey,
} from '@/lib/memory/embedding-constants';

// ============================================================
// Embedding config — app_config JSON (SU-044 Phase 3).
// Heavy deps (@xenova/transformers) are NOT imported here.
// ============================================================

export const EMBEDDING_CONFIG_KEY = 'su044.embeddingSettings';

export type EmbeddingMode = 'off' | 'local' | 'cloud';

export type LocalEmbeddingStatus = 'not_downloaded' | 'ready' | 'error';

export interface EmbeddingSettingsPersisted {
  mode: EmbeddingMode;
  /** Matches memory_embeddings.model_name for current mode. */
  activeModelKey: string;
  local: {
    status: LocalEmbeddingStatus;
    lastError?: string;
    /** Hugging Face id from LOCAL_EMBEDDING_MODEL_CATALOG */
    modelId: string;
    /** Which host loads ONNX weights (e.g. hf-mirror in CN). */
    weightSource: LocalWeightSource;
  };
  cloud: {
    baseURL: string;
    encryptedApiKey: string;
    apiKeyIV: string;
    modelId: string;
    dims?: number;
  };
}

const DEFAULT_SETTINGS: EmbeddingSettingsPersisted = {
  mode: 'off',
  activeModelKey: '',
  local: {
    status: 'not_downloaded',
    modelId: DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
    weightSource: DEFAULT_LOCAL_WEIGHT_SOURCE,
  },
  cloud: {
    baseURL: '',
    encryptedApiKey: '',
    apiKeyIV: '',
    modelId: 'text-embedding-3-small',
  },
};

function sanitize(parsed: unknown): EmbeddingSettingsPersisted {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
  const p = parsed as Record<string, unknown>;
  const mode = p.mode === 'local' || p.mode === 'cloud' ? p.mode : 'off';
  const localRaw = p.local as Record<string, unknown> | undefined;
  const cloudRaw = p.cloud as Record<string, unknown> | undefined;
  const localStatus =
    localRaw?.status === 'ready' || localRaw?.status === 'error'
      ? localRaw.status
      : 'not_downloaded';
  const rawModelId = typeof localRaw?.modelId === 'string' ? localRaw.modelId.trim() : '';
  const localModelId =
    rawModelId && ALLOWED_LOCAL_EMBEDDING_MODEL_IDS.has(rawModelId)
      ? rawModelId
      : DEFAULT_LOCAL_EMBEDDING_MODEL_ID;
  const rawWs = (localRaw as Record<string, unknown> | undefined)?.weightSource;
  const weightSource: LocalWeightSource =
    rawWs === 'huggingface' || rawWs === 'hfMirror'
      ? rawWs
      : DEFAULT_LOCAL_WEIGHT_SOURCE;
  const cloud = {
    baseURL: typeof cloudRaw?.baseURL === 'string' ? cloudRaw.baseURL.replace(/\/+$/, '') : '',
    encryptedApiKey: typeof cloudRaw?.encryptedApiKey === 'string' ? cloudRaw.encryptedApiKey : '',
    apiKeyIV: typeof cloudRaw?.apiKeyIV === 'string' ? cloudRaw.apiKeyIV : '',
    modelId:
      typeof cloudRaw?.modelId === 'string' && cloudRaw.modelId.trim()
        ? cloudRaw.modelId.trim()
        : 'text-embedding-3-small',
    dims: typeof cloudRaw?.dims === 'number' && Number.isFinite(cloudRaw.dims) ? cloudRaw.dims : undefined,
  };
  let activeModelKey = typeof p.activeModelKey === 'string' ? p.activeModelKey : '';
  if (mode === 'local') activeModelKey = buildLocalEmbeddingModelKey(localModelId);
  if (mode === 'cloud' && cloud.baseURL && cloud.modelId) {
    activeModelKey = buildCloudEmbeddingModelKey(cloud.baseURL, cloud.modelId);
  }
  if (mode === 'off') activeModelKey = '';
  return {
    mode,
    activeModelKey,
    local: {
      status: localStatus,
      lastError: typeof localRaw?.lastError === 'string' ? localRaw.lastError : undefined,
      modelId: localModelId,
      weightSource,
    },
    cloud,
  };
}

interface EmbeddingConfigState {
  settings: EmbeddingSettingsPersisted;
  isLoaded: boolean;
  loadConfig: () => Promise<void>;
  setMode: (mode: EmbeddingMode) => Promise<void>;
  setLocalStatus: (status: LocalEmbeddingStatus, lastError?: string) => Promise<void>;
  setCloudConfig: (opts: {
    baseURL: string;
    modelId: string;
    apiKey?: string;
    dims?: number;
  }) => Promise<void>;
  /** Change catalog model; clears local ready state if user was on local. */
  setLocalModelId: (modelId: string) => Promise<void>;
  /** Change weight host (Hugging Face vs hf-mirror); same as model switch. */
  setLocalWeightSource: (source: LocalWeightSource) => Promise<void>;
  getDecryptedCloudApiKey: () => Promise<string>;
  persist: (next: EmbeddingSettingsPersisted) => Promise<void>;
}

async function readPersisted(): Promise<EmbeddingSettingsPersisted> {
  const row = await dbClient.getConfig(EMBEDDING_CONFIG_KEY);
  if (!row?.value) return { ...DEFAULT_SETTINGS };
  try {
    return sanitize(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export type ResolvedEmbeddingMode =
  | { mode: 'off' }
  | { mode: 'local'; activeModelKey: string; localWeightSource: LocalWeightSource }
  | { mode: 'cloud'; activeModelKey: string; baseURL: string; apiKey: string; modelId: string };

/**
 * Read persisted embedding settings and decrypt cloud key (client-only).
 * Used by memory pipeline and retrieval — never import @xenova/transformers here.
 */
export async function loadEmbeddingSettingsResolved(): Promise<ResolvedEmbeddingMode> {
  const s = await readPersisted();
  if (s.mode === 'off') return { mode: 'off' };
  if (s.mode === 'local') {
    if (s.local.status !== 'ready') return { mode: 'off' };
    return {
      mode: 'local',
      activeModelKey: buildLocalEmbeddingModelKey(s.local.modelId),
      localWeightSource: s.local.weightSource,
    };
  }
  if (!s.cloud.baseURL || !s.cloud.encryptedApiKey) return { mode: 'off' };
  const dek = await requireDEK();
  const apiKey = await decrypt(
    { ciphertext: s.cloud.encryptedApiKey, iv: s.cloud.apiKeyIV },
    dek,
  );
  return {
    mode: 'cloud',
    activeModelKey: buildCloudEmbeddingModelKey(s.cloud.baseURL, s.cloud.modelId),
    baseURL: s.cloud.baseURL,
    apiKey,
    modelId: s.cloud.modelId,
  };
}

export const useEmbeddingConfigStore = create<EmbeddingConfigState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  isLoaded: false,

  loadConfig: async () => {
    const settings = await readPersisted();
    set({ settings, isLoaded: true });
  },

  persist: async (next) => {
    await dbClient.setConfig(EMBEDDING_CONFIG_KEY, JSON.stringify(next));
    set({ settings: next });
  },

  setMode: async (mode) => {
    const prev = get().settings;
    let activeModelKey = '';
    if (mode === 'local') {
      activeModelKey = buildLocalEmbeddingModelKey(prev.local.modelId);
    } else if (mode === 'cloud' && prev.cloud.baseURL && prev.cloud.modelId) {
      activeModelKey = buildCloudEmbeddingModelKey(prev.cloud.baseURL, prev.cloud.modelId);
    }
    const next: EmbeddingSettingsPersisted = {
      ...prev,
      mode,
      activeModelKey,
    };
    await get().persist(next);
  },

  setLocalStatus: async (status, lastError) => {
    const prev = get().settings;
    const next: EmbeddingSettingsPersisted = {
      ...prev,
      local: { ...prev.local, status, lastError },
    };
    if (status === 'ready') {
      next.mode = 'local';
      next.activeModelKey = buildLocalEmbeddingModelKey(prev.local.modelId);
    }
    await get().persist(next);
  },

  setCloudConfig: async ({ baseURL, modelId, apiKey, dims }) => {
    const dek = await requireDEK();
    const prev = get().settings;
    const trimmedUrl = baseURL.trim().replace(/\/+$/, '');
    const trimmedModel = modelId.trim() || 'text-embedding-3-small';
    let encryptedApiKey = prev.cloud.encryptedApiKey;
    let apiKeyIV = prev.cloud.apiKeyIV;
    if (apiKey !== undefined) {
      const keyPlain = normalizeApiKeySecret(apiKey);
      if (keyPlain) {
        const enc = await encrypt(keyPlain, dek);
        encryptedApiKey = enc.ciphertext;
        apiKeyIV = enc.iv;
      }
    }
    const next: EmbeddingSettingsPersisted = {
      ...prev,
      cloud: {
        baseURL: trimmedUrl,
        modelId: trimmedModel,
        encryptedApiKey,
        apiKeyIV,
        dims: dims ?? prev.cloud.dims,
      },
    };
    if (trimmedUrl && trimmedModel) {
      next.activeModelKey = buildCloudEmbeddingModelKey(trimmedUrl, trimmedModel);
    }
    await get().persist(next);
  },

  getDecryptedCloudApiKey: async () => {
    const { cloud } = get().settings;
    if (!cloud.encryptedApiKey || !cloud.apiKeyIV) return '';
    const dek = await requireDEK();
    return decrypt({ ciphertext: cloud.encryptedApiKey, iv: cloud.apiKeyIV }, dek);
  },

  setLocalModelId: async (modelId) => {
    if (!ALLOWED_LOCAL_EMBEDDING_MODEL_IDS.has(modelId)) return;
    const prev = get().settings;
    const next: EmbeddingSettingsPersisted = {
      ...prev,
      local: {
        ...prev.local,
        modelId,
        status: 'not_downloaded',
        lastError: undefined,
      },
    };
    if (prev.mode === 'local') {
      next.mode = 'off';
      next.activeModelKey = '';
    }
    await get().persist(next);
  },

  setLocalWeightSource: async (source) => {
    if (!ALLOWED_LOCAL_WEIGHT_SOURCES.has(source)) return;
    const prev = get().settings;
    const next: EmbeddingSettingsPersisted = {
      ...prev,
      local: {
        ...prev.local,
        weightSource: source,
        status: 'not_downloaded',
        lastError: undefined,
      },
    };
    if (prev.mode === 'local') {
      next.mode = 'off';
      next.activeModelKey = '';
    }
    await get().persist(next);
  },
}));
