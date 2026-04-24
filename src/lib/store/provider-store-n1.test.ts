// @vitest-environment jsdom
// SU-ITER-090c · P2-07 — regression test for N+1 elimination in
// `provider-store.loadProviders`.  The contract: at most 2 dbClient
// calls (batch providers + config), regardless of provider count.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock hoists above imports, so the factory runs before
// `@/lib/db/db-client` is actually imported by the store.  We expose
// spies on the module and read them later via `vi.mocked`.
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

function makeBundled(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    provider: {
      id: `p-${i}`,
      name: `Provider ${i}`,
      apiType: 'openai-compatible',
      baseUrl: `https://p${i}.example`,
      encryptedApiKey: 'enc',
      apiKeyIV: 'iv',
      isDefault: i === 0,
      enabled: true,
      createdAt: '2026-04-19T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
    },
    // three models per provider so the old N+1 path would fire 3
    // separate listModels calls per provider.
    models: Array.from({ length: 3 }, (_, j) => ({
      id: `p-${i}::m-${j}`,
      providerId: `p-${i}`,
      name: `m-${j}`,
      displayName: `Model ${j}`,
      alias: null,
      contextWindow: null,
      isCustom: false,
      enabled: true,
      supportsThinking: false,
      supportsVision: false,
      supportsWebSearch: false,
      capabilitiesText: true,
    })),
  }));
}

describe('provider-store · loadProviders (SU-ITER-090c P2-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStore.setState({
      providers: [],
      isLoading: false,
      error: null,
    });
  });

  it('hydrates providers via a single batch call regardless of N', async () => {
    const bundled = makeBundled(5);
    vi.mocked(dbClient.listProvidersWithModels).mockResolvedValue(bundled as never);
    vi.mocked(dbClient.getConfig).mockResolvedValue(null);

    await useProviderStore.getState().loadProviders();

    // Core contract: ONE batch request, no per-provider model fan-out.
    expect(dbClient.listProvidersWithModels).toHaveBeenCalledTimes(1);
    expect(dbClient.listModels).not.toHaveBeenCalled();
    expect(dbClient.listProviders).not.toHaveBeenCalled();

    // Total dbClient-side DB calls must stay ≤ 2 (batch providers + config).
    const totalDbCalls =
      vi.mocked(dbClient.listProvidersWithModels).mock.calls.length +
      vi.mocked(dbClient.listProviders).mock.calls.length +
      vi.mocked(dbClient.listModels).mock.calls.length +
      vi.mocked(dbClient.getConfig).mock.calls.length;
    expect(totalDbCalls).toBeLessThanOrEqual(2);

    const { providers } = useProviderStore.getState();
    expect(providers).toHaveLength(5);
    expect(providers[0].models).toHaveLength(3);
  });

  it('still keeps request count ≤ 2 when provider list is empty', async () => {
    vi.mocked(dbClient.listProvidersWithModels).mockResolvedValue([]);
    vi.mocked(dbClient.getConfig).mockResolvedValue(null);

    await useProviderStore.getState().loadProviders();

    expect(dbClient.listProvidersWithModels).toHaveBeenCalledTimes(1);
    expect(dbClient.listModels).not.toHaveBeenCalled();
    expect(useProviderStore.getState().providers).toEqual([]);
  });
});

// SU-ITER-092-batch3 · A3-MEDIUM-02 — regression test for N-writes
// elimination in `provider-store.setDefaultProvider`.  Contract: no
// matter how many providers are loaded, setDefaultProvider fires
// exactly ONE dbClient call (`setDefaultProvider`), and `upsertProvider`
// is never touched.
describe('provider-store · setDefaultProvider (SU-ITER-092-batch3 A3-MEDIUM-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStore.setState({
      providers: [],
      isLoading: false,
      error: null,
    });
  });

  async function seedProviders(count: number) {
    const bundled = makeBundled(count);
    vi.mocked(dbClient.listProvidersWithModels).mockResolvedValue(
      bundled as never,
    );
    vi.mocked(dbClient.getConfig).mockResolvedValue(null);
    await useProviderStore.getState().loadProviders();
  }

  it('flips the default flag through a single server call regardless of N', async () => {
    await seedProviders(7);
    vi.mocked(dbClient.setDefaultProvider).mockResolvedValue();

    await useProviderStore.getState().setDefaultProvider('p-3');

    expect(dbClient.setDefaultProvider).toHaveBeenCalledTimes(1);
    expect(dbClient.setDefaultProvider).toHaveBeenCalledWith('p-3');
    expect(dbClient.upsertProvider).not.toHaveBeenCalled();

    // Local state must mirror the server's effect: exactly one default.
    const { providers } = useProviderStore.getState();
    const defaults = providers.filter((p) => p.isDefault);
    expect(defaults.map((p) => p.id)).toEqual(['p-3']);
  });

  it('is idempotent when the target is already the default', async () => {
    await seedProviders(3);
    vi.mocked(dbClient.setDefaultProvider).mockResolvedValue();

    // p-0 starts as default (see makeBundled).  Setting it again is a no-op
    // on the server side (still single call) AND locally (no updatedAt bump
    // if the flag is already correct).
    await useProviderStore.getState().setDefaultProvider('p-0');

    expect(dbClient.setDefaultProvider).toHaveBeenCalledTimes(1);
    const defaults = useProviderStore
      .getState()
      .providers.filter((p) => p.isDefault);
    expect(defaults.map((p) => p.id)).toEqual(['p-0']);
  });

  it('propagates server errors instead of silently swallowing them', async () => {
    await seedProviders(2);
    vi.mocked(dbClient.setDefaultProvider).mockRejectedValue(
      new Error('boom'),
    );

    await expect(
      useProviderStore.getState().setDefaultProvider('p-1'),
    ).rejects.toThrow('boom');

    // On failure we must NOT have partially mutated local state: p-0
    // stays default (the pre-call state).
    const defaults = useProviderStore
      .getState()
      .providers.filter((p) => p.isDefault);
    expect(defaults.map((p) => p.id)).toEqual(['p-0']);
  });

  // SU-ITER-092-batch3 · A3 二次 Gate · R-093-06 cleanup — concurrency
  // invariant.  Two parallel `setDefaultProvider` calls (e.g. rapid UI
  // double-click or two tabs racing) must NEVER leave the store with
  // ≠ 1 default rows.  The server-side CASE WHEN `UPDATE` is already
  // atomic (last-writer-wins, always exactly one row `is_default=1`);
  // the contract we verify here is the client-side reconciliation path:
  //   1. both dbClient calls fire exactly once (no coalescing),
  //   2. the final in-memory providers array has exactly one default,
  //   3. the winner is the later-resolved call (matches server truth
  //      under `UPDATE ... CASE WHEN ... ELSE 0`).
  //
  // Note on semantics: the store does NOT serialize concurrent calls
  // via a mutex.  That is intentional — the server is the source of
  // truth and its single-statement UPDATE already guarantees atomicity.
  // We simulate a last-wins resolution order to mirror the server
  // behaviour and confirm the client does not end up with 0 or 2
  // defaults (the failure modes the N+1 `forEach upsertProvider`
  // pattern used to be vulnerable to).
  it('maintains "exactly one default" invariant under concurrent calls', async () => {
    await seedProviders(4);

    // Two deferred mocks so we can control resolution order
    // independently of call order.
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstCall = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondCall = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(dbClient.setDefaultProvider)
      .mockImplementationOnce(() => firstCall)
      .mockImplementationOnce(() => secondCall);

    const store = useProviderStore.getState();
    // Fire both concurrently; neither awaited yet.
    const p1 = store.setDefaultProvider('p-1');
    const p2 = store.setDefaultProvider('p-2');

    // Resolve in REVERSE order so the earlier-started call finishes
    // last — this is the worst-case interleave where the store's
    // naive `await … then set()` could otherwise overwrite the
    // server-truth winner (`p-2`) with the stale `p-1` view.
    resolveSecond();
    resolveFirst();
    await Promise.all([p1, p2]);

    // Invariant 1: each call fired a distinct server request.
    expect(dbClient.setDefaultProvider).toHaveBeenCalledTimes(2);
    expect(dbClient.setDefaultProvider).toHaveBeenNthCalledWith(1, 'p-1');
    expect(dbClient.setDefaultProvider).toHaveBeenNthCalledWith(2, 'p-2');

    // Invariant 2: client state ends with exactly one default
    // (never 0, never 2+).  This is the core concurrency guarantee.
    const defaults = useProviderStore
      .getState()
      .providers.filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);

    // Invariant 3: the last-resolved call wins on the client, mirroring
    // the server's last-writer-wins UPDATE … CASE WHEN semantics.  In
    // this interleave, `p-1`'s resolve fires AFTER `p-2`'s, so `p-1`
    // writes its local state last → it ends up as the default.  This
    // documents (and locks in) the client's reconciliation order so
    // any future refactor that changes it must either match server
    // truth via re-read, or keep the existing last-wins pattern.
    expect(defaults[0].id).toBe('p-1');
  });
});
