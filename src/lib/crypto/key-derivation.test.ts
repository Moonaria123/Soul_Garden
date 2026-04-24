// @vitest-environment jsdom
//
// SU-ITER-090a · P2-12 — salt / hex guards on client-side key derivation.
//
// Scope: verify the explicit length + charset gates we added before the
// `.match()!` calls throw actionable errors instead of the opaque
// "Cannot read properties of null (reading 'map')" from the old code
// path.  Full PBKDF2 behaviour is covered server-side.

import { describe, it, expect } from 'vitest';
import { deriveEncryptionKey, importDEKFromRawHex } from './key-derivation';

describe('deriveEncryptionKey · salt guard (P2-12)', () => {
  it('throws on empty salt', async () => {
    await expect(deriveEncryptionKey('pw', '')).rejects.toThrow(/salt hex/i);
  });

  it('throws on odd-length salt', async () => {
    await expect(deriveEncryptionKey('pw', 'abc')).rejects.toThrow(/salt hex/i);
  });

  it('throws on non-hex characters', async () => {
    await expect(deriveEncryptionKey('pw', 'zzzz')).rejects.toThrow(/salt hex/i);
  });
});

describe('importDEKFromRawHex · hex guard (P2-12)', () => {
  it('throws on wrong length (63 chars)', async () => {
    await expect(importDEKFromRawHex('a'.repeat(63))).rejects.toThrow(/DEK hex/);
  });

  it('throws on wrong length (65 chars)', async () => {
    await expect(importDEKFromRawHex('a'.repeat(65))).rejects.toThrow(/DEK hex/);
  });

  it('throws on non-hex characters at right length', async () => {
    await expect(importDEKFromRawHex('g'.repeat(64))).rejects.toThrow(/DEK hex/);
  });
});

// SU-ITER-092-batch2 · crypto coverage — add happy-path coverage so
// the PBKDF2 derivation body (lines 45-71 in the source) actually runs
// under test.  PBKDF2 @ 600 000 iterations is slow, but one derive per
// suite is tolerable; the guard-only tests above keep the hot loop small.
describe('deriveEncryptionKey · happy path', () => {
  it('produces an AES-GCM CryptoKey usable for encrypt/decrypt', async () => {
    const salt = 'a'.repeat(32); // 16-byte hex salt
    const key = await deriveEncryptionKey('test-password', salt);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
  });

  it('deterministically derives the same key bytes from the same salt+password', async () => {
    const salt = 'b'.repeat(32);
    const k1 = await deriveEncryptionKey('pw', salt);
    const k2 = await deriveEncryptionKey('pw', salt);
    const r1 = new Uint8Array(await crypto.subtle.exportKey('raw', k1));
    const r2 = new Uint8Array(await crypto.subtle.exportKey('raw', k2));
    expect(Array.from(r1)).toEqual(Array.from(r2));
  });
});

describe('importDEKFromRawHex · happy path', () => {
  it('imports 32 bytes of hex into an AES-GCM key that round-trips exportKey', async () => {
    const hex = 'c'.repeat(64);
    const key = await importDEKFromRawHex(hex);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    expect(raw.length).toBe(32);
    // First byte of 'c'.repeat → 0xcc.
    expect(raw[0]).toBe(0xcc);
  });
});
