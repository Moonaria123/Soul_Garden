import { beforeEach, describe, expect, it, vi } from 'vitest';

const getConfig = vi.fn();
vi.mock('@/lib/db/db-client', () => ({
  getConfig: (...a: unknown[]) => getConfig(...a),
  setConfig: vi.fn(),
}));

const requireDEK = vi.fn();
vi.mock('@/lib/crypto/reunlock', () => ({
  requireDEK: () => requireDEK(),
}));

const decrypt = vi.fn();
vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn(),
  decrypt: (...a: unknown[]) => decrypt(...a),
}));

import {
  DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
  buildLocalEmbeddingModelKey,
} from '@/lib/memory/embedding-constants';
import { loadEmbeddingSettingsResolved } from './embedding-config-store';

const defaultLocalKey = buildLocalEmbeddingModelKey(DEFAULT_LOCAL_EMBEDDING_MODEL_ID);

describe('loadEmbeddingSettingsResolved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireDEK.mockResolvedValue({} as CryptoKey);
    decrypt.mockResolvedValue('plain-api-key');
  });

  it('returns off when persisted mode is off', async () => {
    getConfig.mockResolvedValue({
      value: JSON.stringify({
        mode: 'off',
        activeModelKey: '',
        local: {
          status: 'not_downloaded',
          modelId: DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
          weightSource: 'hfMirror',
        },
        cloud: {
          baseURL: '',
          encryptedApiKey: '',
          apiKeyIV: '',
          modelId: 'text-embedding-3-small',
        },
      }),
    });
    await expect(loadEmbeddingSettingsResolved()).resolves.toEqual({ mode: 'off' });
  });

  it('returns off when local is not ready', async () => {
    getConfig.mockResolvedValue({
      value: JSON.stringify({
        mode: 'local',
        activeModelKey: defaultLocalKey,
        local: {
          status: 'not_downloaded',
          modelId: DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
          weightSource: 'hfMirror',
        },
        cloud: {
          baseURL: '',
          encryptedApiKey: '',
          apiKeyIV: '',
          modelId: 'text-embedding-3-small',
        },
      }),
    });
    await expect(loadEmbeddingSettingsResolved()).resolves.toEqual({ mode: 'off' });
  });

  it('returns local when status is ready', async () => {
    getConfig.mockResolvedValue({
      value: JSON.stringify({
        mode: 'local',
        activeModelKey: defaultLocalKey,
        local: {
          status: 'ready',
          modelId: DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
          weightSource: 'hfMirror',
        },
        cloud: {
          baseURL: '',
          encryptedApiKey: '',
          apiKeyIV: '',
          modelId: 'text-embedding-3-small',
        },
      }),
    });
    await expect(loadEmbeddingSettingsResolved()).resolves.toEqual({
      mode: 'local',
      activeModelKey: defaultLocalKey,
      localWeightSource: 'hfMirror',
    });
  });

  it('returns off when cloud missing url or key', async () => {
    getConfig.mockResolvedValue({
      value: JSON.stringify({
        mode: 'cloud',
        activeModelKey: '',
        local: {
          status: 'not_downloaded',
          modelId: DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
          weightSource: 'hfMirror',
        },
        cloud: {
          baseURL: '',
          encryptedApiKey: 'c',
          apiKeyIV: 'i',
          modelId: 'text-embedding-3-small',
        },
      }),
    });
    await expect(loadEmbeddingSettingsResolved()).resolves.toEqual({ mode: 'off' });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('returns cloud with decrypted key', async () => {
    getConfig.mockResolvedValue({
      value: JSON.stringify({
        mode: 'cloud',
        activeModelKey: '',
        local: {
          status: 'not_downloaded',
          modelId: DEFAULT_LOCAL_EMBEDDING_MODEL_ID,
          weightSource: 'hfMirror',
        },
        cloud: {
          baseURL: 'https://api.openai.com/v1',
          encryptedApiKey: 'cipher',
          apiKeyIV: 'iv',
          modelId: 'text-embedding-3-small',
        },
      }),
    });
    const r = await loadEmbeddingSettingsResolved();
    expect(r).toMatchObject({
      mode: 'cloud',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'plain-api-key',
      modelId: 'text-embedding-3-small',
    });
    if (r.mode !== 'cloud') throw new Error('expected cloud');
    expect(r.activeModelKey).toContain('https://api.openai.com/v1');
    expect(decrypt).toHaveBeenCalledWith(
      { ciphertext: 'cipher', iv: 'iv' },
      expect.anything(),
    );
  });
});
