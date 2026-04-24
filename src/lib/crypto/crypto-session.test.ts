/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · crypto coverage — `crypto/index.ts` (the DEK
 * session manager) previously had 11 % coverage because every caller
 * either mocked it entirely or used the hooks in `reunlock.ts`.
 *
 * This file covers the closure-based state machine directly so
 * `setDEK` / `clearSession` / `isSessionActive` / `getDEK` /
 * `exportDEKHex` / `importDEKFromHex` are all exercised.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearSession,
  exportDEKHex,
  getDEK,
  importDEKFromHex,
  isSessionActive,
  setDEK,
} from './index';

async function makeAesKey(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

describe('crypto/index · session state machine', () => {
  beforeEach(() => clearSession());
  afterEach(() => clearSession());

  it('is inactive until setDEK is called', async () => {
    expect(isSessionActive()).toBe(false);
    expect(() => getDEK()).toThrow(/no active crypto session/i);

    const key = await makeAesKey();
    await setDEK(key);
    expect(isSessionActive()).toBe(true);
    expect(getDEK()).toBe(key);
  });

  it('clearSession zeros the in-memory DEK reference', async () => {
    await setDEK(await makeAesKey());
    clearSession();
    expect(isSessionActive()).toBe(false);
    expect(() => getDEK()).toThrow();
  });

  it('exportDEKHex returns null when inactive', async () => {
    expect(await exportDEKHex()).toBeNull();
  });

  it('exportDEKHex → importDEKFromHex round-trips the raw key bytes', async () => {
    const orig = await makeAesKey();
    await setDEK(orig);
    const hex = await exportDEKHex();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);

    clearSession();
    expect(isSessionActive()).toBe(false);

    await importDEKFromHex(hex!);
    expect(isSessionActive()).toBe(true);
    // Identity of CryptoKey objects differs, so re-export and compare raw bytes.
    const roundHex = await exportDEKHex();
    expect(roundHex).toBe(hex);
  });
});
