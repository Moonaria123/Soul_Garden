// ============================================================
// Password hashing helpers — works in both Node (API routes)
// and Browser (auth-store).  Intentionally NOT marked 'use client'.
// hash-wasm is isomorphic and loads the Argon2id WebAssembly module
// in whichever runtime imports it.
// ============================================================

import { argon2id, argon2Verify } from 'hash-wasm';

const ARGON2_CONFIG = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MB — OWASP recommended
  hashLength: 32,
  outputType: 'encoded' as const,
};

/** Hash a password using Argon2id. Returns the encoded hash and hex salt. */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hash = await argon2id({ password, salt, ...ARGON2_CONFIG });
  return { hash, salt: saltHex };
}

/** Verify a password against an Argon2id encoded hash. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  return argon2Verify({ password, hash: encodedHash });
}
