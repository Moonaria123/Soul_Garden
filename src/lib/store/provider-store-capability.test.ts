// @vitest-environment jsdom
// SU-ITER-094 · P0-1 — regression test for capability probe
// writeback.  Contract: `setModelCapability` updates the targeted
// model's `capabilities.<cap>` + the legacy `supports*` mirror,
// persists via ONE `upsertModel` call, and leaves sibling models +
// providers untouched.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/db-client', () => ({
  listProvidersWithModels: vi.fn(),
  listProviders: vi.fn(),
  listModels: vi.fn(),
  getConfig: vi.fn(),
  upsertProvider: vi.fn(),
  setDefaultProvider: vi.fn(),
  upsertModel: vi.fn(),
  deleteModel: vi.fn(),
  deleteProvider: vi.fn(),
  deleteModelsForProvider: vi.fn(),
  setConfig: vi.fn(),
  session: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@/lib/crypto/reunlock', () => ({
  requireDEK: vi.fn(),
}));

import * as dbClient from '@/lib/db/db-client';
import { useProviderStore } from './provider-store';
import type { LLMProvider } from '@/types';

function makeProvider(id: string, modelIds: string[]): LLMProvider {
  return {
    id,
    name: `Provider ${id}`,
    apiType: 'openai-compatible',
    baseURL: `https://${id}.example`,
    encryptedApiKey: 'enc',
    apiKeyIV: 'iv',
    isDefault: id === 'p-a',
    enabled: true,
    models: modelIds.map((mid) => ({
      id: mid,
      capabilities: { text: true, vision: false, thinking: false, webSearch: false },
      supportsThinking: false,
      supportsVision: false,
      supportsWebSearch: false,
    })),
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

describe('provider-store · setModelCapability (SU-ITER-094 P0-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStore.setState({
      providers: [
        makeProvider('p-a', ['gpt-4o', 'gpt-4o-mini']),
        makeProvider('p-b', ['claude-3-5-sonnet']),
      ],
      isLoading: false,
      error: null,
    });
  });

  it('writes both capabilities.<cap> and supports* mirror for the targeted model', async () => {
    vi.mocked(dbClient.upsertModel).mockResolvedValue(undefined as never);

    await useProviderStore.getState().setModelCapability('p-a', 'gpt-4o', 'vision', true);

    const { providers } = useProviderStore.getState();
    const target = providers.find((p) => p.id === 'p-a')!.models.find((m) => m.id === 'gpt-4o')!;
    expect(target.capabilities.vision).toBe(true);
    expect(target.supportsVision).toBe(true);
    // unrelated caps untouched
    expect(target.capabilities.thinking).toBe(false);
    expect(target.capabilities.webSearch).toBe(false);
    expect(target.supportsThinking).toBe(false);
  });

  it('persists via exactly one upsertModel call', async () => {
    vi.mocked(dbClient.upsertModel).mockResolvedValue(undefined as never);

    await useProviderStore.getState().setModelCapability('p-a', 'gpt-4o', 'webSearch', true);

    expect(dbClient.upsertModel).toHaveBeenCalledTimes(1);
    const row = vi.mocked(dbClient.upsertModel).mock.calls[0][0];
    expect(row.providerId).toBe('p-a');
    expect(row.name).toBe('gpt-4o');
    expect(row.supportsWebSearch).toBe(true);
  });

  it('does not mutate sibling models or other providers', async () => {
    vi.mocked(dbClient.upsertModel).mockResolvedValue(undefined as never);

    await useProviderStore.getState().setModelCapability('p-a', 'gpt-4o', 'thinking', true);

    const { providers } = useProviderStore.getState();
    const sibling = providers.find((p) => p.id === 'p-a')!.models.find((m) => m.id === 'gpt-4o-mini')!;
    const otherProvider = providers.find((p) => p.id === 'p-b')!.models[0];
    expect(sibling.capabilities.thinking).toBe(false);
    expect(otherProvider.capabilities.thinking).toBe(false);
  });

  it('supports recording an unsupported=false probe result', async () => {
    // seed with a previously-true value so we exercise the flip
    useProviderStore.setState({
      providers: [
        {
          ...makeProvider('p-a', ['gpt-4o']),
          models: [
            {
              id: 'gpt-4o',
              capabilities: { text: true, vision: true, thinking: true, webSearch: true },
              supportsThinking: true,
              supportsVision: true,
              supportsWebSearch: true,
            },
          ],
        },
      ],
    });
    vi.mocked(dbClient.upsertModel).mockResolvedValue(undefined as never);

    await useProviderStore.getState().setModelCapability('p-a', 'gpt-4o', 'webSearch', false);

    const target = useProviderStore.getState().providers[0].models[0];
    expect(target.capabilities.webSearch).toBe(false);
    expect(target.supportsWebSearch).toBe(false);
  });

  it('silently no-ops when provider id is unknown', async () => {
    await useProviderStore.getState().setModelCapability('does-not-exist', 'gpt-4o', 'vision', true);
    expect(dbClient.upsertModel).not.toHaveBeenCalled();
  });

  it('silently no-ops when model id is unknown', async () => {
    await useProviderStore.getState().setModelCapability('p-a', 'does-not-exist', 'vision', true);
    expect(dbClient.upsertModel).not.toHaveBeenCalled();
  });
});
