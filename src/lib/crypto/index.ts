'use client';

import { hashPassword, verifyPassword, deriveEncryptionKey, importDEKFromRawHex } from './key-derivation';
import { encrypt, decrypt, encryptObject, decryptObject } from './encryption';

// ============================================================
// CryptoManager — Ephemeral DEK holder
// The DEK normally lives ONLY in this module's closure.
// When the user opts into "Remember this tab" (SU-087), raw bytes
// may also be mirrored into sessionStorage for refresh recovery.
// clearSession() zeros both in-memory and sessionStorage copies.
// ============================================================

let _dek: CryptoKey | null = null;

export async function initSession(password: string, salt: string): Promise<void> {
  _dek = await deriveEncryptionKey(password, salt);
}

export async function setDEK(dek: CryptoKey): Promise<void> {
  _dek = dek;
}

export function clearSession(): void {
  _dek = null;
}

export function isSessionActive(): boolean {
  return _dek !== null;
}

export function getDEK(): CryptoKey {
  if (!_dek) {
    throw new Error('No active crypto session. User must be authenticated.');
  }
  return _dek;
}

/**
 * Export the current DEK as a hex string.
 * Returns null if no active session.
 */
export async function exportDEKHex(): Promise<string | null> {
  if (!_dek) return null;
  try {
    const raw = await crypto.subtle.exportKey('raw', _dek);
    return Array.from(new Uint8Array(raw))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    console.warn('[crypto] exportDEKHex failed:', e);
    return null;
  }
}

/**
 * Import a previously exported DEK hex and set it as the active session key.
 */
export async function importDEKFromHex(hex: string): Promise<void> {
  _dek = await importDEKFromRawHex(hex);
}

export {
  hashPassword,
  verifyPassword,
  deriveEncryptionKey,
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
};
