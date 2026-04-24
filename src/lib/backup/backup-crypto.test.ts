// @vitest-environment jsdom
// SU-ITER-091-batch3 — runtime decrypt test cases for
// `decryptPayloadWithDekHex` need `crypto.subtle` + `TextEncoder`,
// hence the jsdom env header.  Node ≥ 18 provides WebCrypto under the
// same global name so the tests run identically in both envs.

import { describe, expect, it } from 'vitest';
import {
  EncryptedPayloadSchema,
  BackupPayloadShapeError,
  decryptPayloadWithDekHex,
} from './backup-crypto';
import { importDEKFromRawHex } from '@/lib/crypto/key-derivation';
import { encrypt } from '@/lib/crypto';

// SU-ITER-089 · P1-7 — guard `decryptPayload`'s pre-flight shape check.
// Runtime decryption requires a DEK / WebCrypto and is covered by the
// broader restore integration tests; this file pins the Zod schema
// that blocks malformed imports from ever reaching GCM.

describe('EncryptedPayloadSchema', () => {
  it('accepts a minimal v0 payload (ciphertext + iv)', () => {
    const ok = EncryptedPayloadSchema.safeParse({
      ciphertext: 'AAAAAAAA',
      iv: 'BBBBBBBB',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a payload that carries an optional salt', () => {
    const ok = EncryptedPayloadSchema.safeParse({
      ciphertext: 'AAAAAAAA',
      iv: 'BBBBBBBB',
      salt: 'CCCCCCCC',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts URL-safe base64 variants', () => {
    const ok = EncryptedPayloadSchema.safeParse({
      ciphertext: 'abc_def-GHI=',
      iv: '1234-5_67',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects payloads missing ciphertext', () => {
    const result = EncryptedPayloadSchema.safeParse({ iv: 'AAAA' });
    expect(result.success).toBe(false);
  });

  it('rejects payloads missing iv', () => {
    const result = EncryptedPayloadSchema.safeParse({ ciphertext: 'AAAA' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string fields so they never reach atob()', () => {
    const result = EncryptedPayloadSchema.safeParse({
      ciphertext: { nested: 'object' },
      iv: 'AAAA',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty strings (clearer than an opaque GCM error)', () => {
    const result = EncryptedPayloadSchema.safeParse({ ciphertext: '', iv: '' });
    expect(result.success).toBe(false);
  });

  it('rejects characters outside the base64 alphabet', () => {
    const result = EncryptedPayloadSchema.safeParse({
      ciphertext: 'AAAA',
      iv: 'not base64!!',
    });
    expect(result.success).toBe(false);
  });

  it('strips nothing — strict mode rejects unknown keys', () => {
    const result = EncryptedPayloadSchema.safeParse({
      ciphertext: 'AAAA',
      iv: 'BBBB',
      extraField: 'sneaky',
    });
    expect(result.success).toBe(false);
  });

  it('rejects arrays and primitives at the top level', () => {
    expect(EncryptedPayloadSchema.safeParse([]).success).toBe(false);
    expect(EncryptedPayloadSchema.safeParse('ciphertext').success).toBe(false);
    expect(EncryptedPayloadSchema.safeParse(42).success).toBe(false);
    expect(EncryptedPayloadSchema.safeParse(null).success).toBe(false);
  });
});

// SU-ITER-091-batch3 — `decryptPayloadWithDekHex` is the legacy
// one-shot decrypt helper used by the V1 backup compatibility path.
// These tests pin the contract that matters to the server endpoint
// and UI flow: round-trip success, hard failure on wrong DEK (never
// silent fallback to plaintext), Zod guard fires before the key is
// imported, and malformed hex DEKs fail fast.
describe('decryptPayloadWithDekHex', () => {
  // 32 bytes / 64 hex chars — matches the server-side DEK format.
  const dekHexA =
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  const dekHexB =
    'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

  async function encryptWith(hexKey: string, plaintext: string): Promise<string> {
    const key = await importDEKFromRawHex(hexKey);
    const payload = await encrypt(plaintext, key);
    return JSON.stringify(payload);
  }

  it('round-trips plaintext when the caller supplies the same hex DEK', async () => {
    const encrypted = await encryptWith(dekHexA, 'hello v1 backup');
    const out = await decryptPayloadWithDekHex(encrypted, dekHexA);
    expect(out).toBe('hello v1 backup');
  });

  it('fails loudly on a wrong hex DEK (never returns garbage plaintext)', async () => {
    const encrypted = await encryptWith(dekHexA, 'hello v1 backup');
    // AES-GCM authentication tag mismatch → throws; we do NOT
    // fall back to any other key material.
    await expect(decryptPayloadWithDekHex(encrypted, dekHexB)).rejects.toThrow();
  });

  it('surfaces a BackupPayloadShapeError on malformed JSON BEFORE touching the DEK', async () => {
    const err = await decryptPayloadWithDekHex('not-json', dekHexA).catch((e) => e);
    expect(err).toBeInstanceOf(BackupPayloadShapeError);
  });

  it('rejects payloads that pass JSON.parse but fail the Zod shape guard', async () => {
    const err = await decryptPayloadWithDekHex(
      JSON.stringify({ ciphertext: 123, iv: 'AAAA' }),
      dekHexA,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BackupPayloadShapeError);
  });

  it('rejects a malformed hex DEK (length / charset mismatch)', async () => {
    const encrypted = await encryptWith(dekHexA, 'irrelevant');
    await expect(
      decryptPayloadWithDekHex(encrypted, 'not-hex'),
    ).rejects.toThrow();
    await expect(
      decryptPayloadWithDekHex(encrypted, dekHexA.slice(0, 10)),
    ).rejects.toThrow();
  });
});
