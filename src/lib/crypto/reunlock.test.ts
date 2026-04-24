/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · crypto coverage — `reunlock.ts` sat at 18 %
 * because its branches (`isSessionActive` vs resolver vs cancelled)
 * were only exercised indirectly through component tests.  These
 * tests pin the three branches + the happy-path where the resolver
 * produces a CryptoKey.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearSession, setDEK } from './index';
import { requireDEK, setReUnlockResolver } from './reunlock';

describe('requireDEK · re-unlock branching', () => {
  beforeEach(() => {
    clearSession();
    setReUnlockResolver(null);
  });

  afterEach(() => {
    clearSession();
    setReUnlockResolver(null);
    vi.restoreAllMocks();
  });

  it('returns the active DEK without invoking the resolver when a session exists', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    await setDEK(key);

    const resolver = vi.fn(async () => null);
    setReUnlockResolver(resolver);

    const result = await requireDEK();
    expect(result).toBe(key);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('throws when no resolver is registered and no session is active', async () => {
    await expect(requireDEK()).rejects.toThrow(/no re-unlock resolver/i);
  });

  it('throws "cancelled" when the resolver returns null', async () => {
    setReUnlockResolver(async () => null);
    await expect(requireDEK()).rejects.toThrow(/cancelled/i);
  });

  it('returns the resolver-supplied key on successful re-unlock', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const newKey = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    setReUnlockResolver(async () => newKey);

    const result = await requireDEK();
    expect(result).toBe(newKey);
  });
});
