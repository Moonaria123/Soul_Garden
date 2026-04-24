'use client';

import { getDEK, isSessionActive } from './index';

// ============================================================
// Re-Unlock Helper (SU-087)
// When the client DEK is absent (e.g. after page refresh without
// "Remember this tab"), DEK-requiring operations call requireDEK()
// which delegates to a registered resolver — typically a dialog
// that asks the user for their password and re-derives the DEK.
// ============================================================

export type ReUnlockResolver = () => Promise<CryptoKey | null>;

let _resolver: ReUnlockResolver | null = null;

/**
 * Register the active re-unlock resolver (usually mounted once in
 * the main layout by the ReUnlockDialog component).
 */
export function setReUnlockResolver(resolver: ReUnlockResolver | null): void {
  _resolver = resolver;
}

/**
 * Return the active DEK, re-unlocking via the resolver if needed.
 *
 * Throws if the user cancels or no resolver is registered.
 */
export async function requireDEK(): Promise<CryptoKey> {
  if (isSessionActive()) {
    return getDEK();
  }
  if (!_resolver) {
    throw new Error('DEK unavailable and no re-unlock resolver registered. User must log in again.');
  }
  const key = await _resolver();
  if (!key) {
    throw new Error('Re-unlock cancelled.');
  }
  // Resolver is expected to have already called setDEK / importDEKFromHex,
  // but we double-check and return the key directly to simplify callers.
  return key;
}
