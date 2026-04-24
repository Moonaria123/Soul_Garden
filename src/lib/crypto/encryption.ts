'use client';

import type { EncryptedPayload } from '@/types';

// ============================================================
// AES-256-GCM Encryption / Decryption
// Used for sensitive fields (API keys) before storing in SQLite.
// DEK lives ONLY in memory — see CryptoManager in index.ts.
// ============================================================

/**
 * Encrypt a string using AES-256-GCM.
 * Returns Base64-encoded ciphertext and IV.
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 */
export async function decrypt(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<string> {
  const ciphertextBuffer = base64ToBuffer(payload.ciphertext);
  const iv = base64ToBuffer(payload.iv);

  // SU-ITER-091-batch2 · P3-04 — we can't drop the `BufferSource`
  // cast because TS lib.dom narrows `BufferSource` to
  // `ArrayBufferView<ArrayBuffer>` while `Uint8Array` carries the
  // wider `Uint8Array<ArrayBufferLike>` generic (ArrayBuffer |
  // SharedArrayBuffer).  The reviewer's hunch — that the cast looked
  // superfluous — was right on paper but contradicted by the DOM
  // typings shipped in TS 5.7.  We keep the casts, document *why*
  // they survive, and fold them into a single call site so it's
  // obvious at review time.
  const ivSource = iv as BufferSource;
  const ciphertextSource = ciphertextBuffer as BufferSource;
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivSource },
    key,
    ciphertextSource,
  );

  return new TextDecoder().decode(plaintextBuffer);
}

/**
 * Encrypt a JSON-serializable object.
 */
export async function encryptObject<T>(
  obj: T,
  key: CryptoKey
): Promise<EncryptedPayload> {
  return encrypt(JSON.stringify(obj), key);
}

/**
 * Decrypt a payload back into a typed object.
 */
export async function decryptObject<T>(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<T> {
  const json = await decrypt(payload, key);
  // SU-ITER-091-batch2 · P3-04 — `JSON.parse` returns `any`, which is
  // assignable to `T` without an explicit cast.  Keep the generic in
  // the signature as the caller-facing contract but drop the redundant
  // `as T` assertion here.
  return JSON.parse(json);
}

// --- Helpers ---

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
