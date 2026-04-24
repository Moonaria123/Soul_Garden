/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// SU-ITER-091-batch1 · R-C3 — the browser-side `post` helper used
// to hard-code a 10 s AbortController deadline, which falsely
// aborted the `migration/v1-to-v2` / `accounts/change-password` /
// `migration/recover-from-*` routes on any sizeable account.  The
// fix lets those four call-sites opt into a 10-minute deadline
// while every other DB call keeps the 10 s ceiling for "server
// stuck" detection.  These tests pin the contract.
//
// We drive the feature through the real public `dbClient.*`
// exports (instead of exporting `post` directly for the test) so
// the test validates the *wiring* and not just the helper.
// ============================================================

// Need fake timers to distinguish a 10 s vs a 10 min abort deadline
// without actually sleeping the test runner that long.
const ONE_SECOND = 1_000;
const ONE_MINUTE = 60 * ONE_SECOND;

describe('db-client timeout wiring (SU-091-batch1 · R-C3)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  async function importClient() {
    // Re-import inside the test so the jsdom fetch mock is visible
    // to the module's top-level `BASE = '/api/db'` usage.
    return await import('./db-client');
  }

  it('aborts default POSTs after ~10 s', async () => {
    fetchSpy.mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { listProviders } = await importClient();
    const pending = listProviders().catch((err: unknown) => err);

    // Just under 10 s should NOT abort yet.
    await vi.advanceTimersByTimeAsync(9 * ONE_SECOND);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    const signal = (call[1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    // Cross the 10 s threshold → AbortController fires.
    await vi.advanceTimersByTimeAsync(2 * ONE_SECOND);
    expect(signal.aborted).toBe(true);
    // jsdom exposes `DOMException` which isn't an `Error` subclass in
    // every runtime; the abort itself is the contract we're pinning.
    await pending;
  });

  it('extends the deadline for migration/v1-to-v2 to ~10 min', async () => {
    fetchSpy.mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { runMigrationV1ToV2 } = await importClient();
    const pending = runMigrationV1ToV2('user-1', 'pw').catch((err: unknown) => err);

    // 30 seconds: below the default 10 s cap's cousin, but we're
    // on the LONG path — must NOT abort yet.
    await vi.advanceTimersByTimeAsync(30 * ONE_SECOND);
    const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    // 5 minutes in — still nowhere near the 10 min deadline.
    await vi.advanceTimersByTimeAsync(5 * ONE_MINUTE);
    expect(signal.aborted).toBe(false);

    // Past 10 min → abort fires.
    await vi.advanceTimersByTimeAsync(6 * ONE_MINUTE);
    expect(signal.aborted).toBe(true);
    await pending;
  });

  it('extends the deadline for accounts/change-password to ~10 min', async () => {
    fetchSpy.mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { changePassword } = await importClient();
    const pending = changePassword({
      id: 'user-1',
      currentPassword: 'old',
      newPassword: 'newPassword123!',
    }).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(30 * ONE_SECOND);
    const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(11 * ONE_MINUTE);
    expect(signal.aborted).toBe(true);
    await pending;
  });

  it('extends the deadline for memory/restore-entity-atomic (Concern-1 regression)', async () => {
    // SU-ITER-091-batch1 mini-Gate · Concern-1 — `restoreEntityAtomic`
    // used to inherit the default 10 s deadline even though the server
    // transaction can insert up to 10^6 messages per the schema cap.
    // A 10 s abort on an in-flight transaction is a Tampering hazard
    // (see comment in db-client.ts).  Pin the long deadline.
    fetchSpy.mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { restoreEntityAtomic } = await importClient();
    const pending = restoreEntityAtomic(
      { entity: { id: 'e' } },
      'replace-existing',
    ).catch((err: unknown) => err);

    // 5 minutes — well past default 10 s, still inside the long cap.
    await vi.advanceTimersByTimeAsync(5 * ONE_MINUTE);
    const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(6 * ONE_MINUTE);
    expect(signal.aborted).toBe(true);
    await pending;
  });

  it('extends the deadline for migration/recover-from-rekey-bak', async () => {
    fetchSpy.mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { recoverFromRekeyBak } = await importClient();
    const pending = recoverFromRekeyBak().catch((err: unknown) => err);

    // Well past the default 10 s cap, still well under 10 min.
    await vi.advanceTimersByTimeAsync(5 * ONE_MINUTE);
    const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(6 * ONE_MINUTE);
    expect(signal.aborted).toBe(true);
    await pending;
  });

  // ============================================================
  // SU-ITER-092-batch1 · Nit-1 — production guard on timeoutMs <= 0.
  //
  // `{ timeoutMs: 0 }` is a test-only escape hatch that disables the
  // AbortController entirely.  In production it would silently mask a
  // hung server, so the helper throws at the entry point.  These tests
  // pin both the positive (dev/test bypass) and negative (prod reject)
  // paths.
  // ============================================================
  describe('production guard on timeoutMs <= 0 (SU-092-batch1 · Nit-1)', () => {
    // `vi.stubEnv` / `vi.unstubAllEnvs` is the supported way to flip
    // `process.env.NODE_ENV` under vitest — `Object.defineProperty` on
    // `process.env` throws because the object's own descriptor is
    // locked (non-configurable getter).
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('throws when NODE_ENV=production and timeoutMs is 0', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      // The `__forTesting` namespace itself is guarded by code-N-2;
      // `SU_ALLOW_TEST_HOOKS=1` is the sanctioned escape hatch so the
      // inner guard (the subject of this test) can be reached.
      vi.stubEnv('SU_ALLOW_TEST_HOOKS', '1');
      const { __forTesting } = await importClient();
      await expect(
        __forTesting.post('noop', {}, { timeoutMs: 0 }),
      ).rejects.toThrow(/non-positive timeoutMs=0.*test-only.*production/);
      // fetch must never be reached — the guard aborts before the
      // request is constructed.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws when NODE_ENV=production and timeoutMs is negative', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('SU_ALLOW_TEST_HOOKS', '1');
      const { __forTesting } = await importClient();
      await expect(
        __forTesting.post('noop', {}, { timeoutMs: -1 }),
      ).rejects.toThrow(/non-positive timeoutMs=-1/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts timeoutMs=0 outside production (disables deadline)', async () => {
      // Resolve fetch quickly so the pending promise settles; the
      // point of this assertion is "no auto-abort timer fires".
      fetchSpy.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const { __forTesting } = await importClient();
      const result = await __forTesting.post<{ ok: boolean }>(
        'noop',
        {},
        { timeoutMs: 0 },
      );
      expect(result).toEqual({ ok: true });

      // Verify no AbortController deadline was installed.  The request
      // init still carries a signal (guard above always builds one),
      // but it must NOT auto-abort when timeoutMs=0.
      const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
      await vi.advanceTimersByTimeAsync(30 * ONE_MINUTE);
      expect(signal.aborted).toBe(false);
    });
  });
});
