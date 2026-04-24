import { describe, it, expect } from 'vitest';
import {
  deriveDbEncryptionKeyHex_v1_legacy,
  deriveDbEncryptionKeyHex_v2,
  dekBufferToHex,
  __forTesting,
} from './key-derivation-server';

// PBKDF2_ITERATIONS re-exported via __forTesting for the domain-
// separation assertion below (not used here, kept for future golden
// regenerations).
void __forTesting.PBKDF2_ITERATIONS;

// ============================================================
// SU-ITER-089 · P1-1 · B8-10 — DEK derivation unit tests.
//
// Three invariants matter here and cannot be lost in a refactor:
//
//   1. DOMAIN SEPARATION — `v2(pwd, salt)` MUST differ from
//      `v1_legacy(pwd, salt)` for every non-trivial input.  This is
//      what makes the v1→v2 migration necessary; conflating them
//      would reintroduce the P0-D bug.
//
//   2. DETERMINISM — Identical `(password, saltHex)` pairs MUST
//      produce identical DEKs.  Migration restore, rekey, and session
//      open all rely on being able to re-derive the key next time.
//
//   3. V1 LEGACY FAITHFULNESS — `v1_legacy` MUST reproduce the exact
//      NaN-to-zero coercion the original buggy client performed, so
//      existing v1 database files still decrypt.  If this ever
//      drifts, v1 users can no longer migrate.
// ============================================================

const SALT = '0011223344556677889900aabbccddee'; // 16 bytes hex
const PASSWORD = 'correct horse battery staple';

describe('deriveDbEncryptionKeyHex_v2', () => {
  it('is deterministic for the same password+salt', async () => {
    const a = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    const b = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    expect(a.toString('hex')).toBe(b.toString('hex'));
  });

  it('returns a 32-byte (256-bit) key', async () => {
    const buf = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    expect(buf.length).toBe(32);
  });

  it('changes when the salt changes', async () => {
    const a = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    const b = await deriveDbEncryptionKeyHex_v2(
      PASSWORD,
      'ffeeddccbbaa00998877665544332211',
    );
    expect(a.toString('hex')).not.toBe(b.toString('hex'));
  });

  it('changes when the password changes', async () => {
    const a = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    const b = await deriveDbEncryptionKeyHex_v2('different password', SALT);
    expect(a.toString('hex')).not.toBe(b.toString('hex'));
  });

  it('rejects invalid salt hex', async () => {
    await expect(
      deriveDbEncryptionKeyHex_v2(PASSWORD, 'not-hex-at-all'),
    ).rejects.toThrow(/saltHex/);
    await expect(
      deriveDbEncryptionKeyHex_v2(PASSWORD, '001'), // odd length
    ).rejects.toThrow(/saltHex/);
  });

  it('produces a stable golden hex for a fixed (password, salt) pair', async () => {
    // Golden regression (Stage B Gate · N-3) — locks the v2 derivation
    // bit-for-bit so a later tweak to the domain suffix, salt assembly
    // order, PBKDF2 parameters, or any upstream library quirk is caught
    // immediately.  Re-computing by hand from primitives is error-prone
    // (see v1_legacy: we already once had an off-by-one bug here), so
    // we anchor against a value captured on first ship.  If this ever
    // shifts, EVERY existing v2 database becomes undecryptable — treat
    // any update to this constant as a breaking change.
    const actual = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    expect(actual.toString('hex')).toBe(
      '7fcab522c247cf3f0c1a0028aedd096c0bf3b3ffaa7651b62a5086e9561384ad',
    );
  });
});

describe('deriveDbEncryptionKeyHex_v1_legacy (bug reproduction)', () => {
  it('is deterministic for the same password+salt', async () => {
    const a = await deriveDbEncryptionKeyHex_v1_legacy(PASSWORD, SALT);
    const b = await deriveDbEncryptionKeyHex_v1_legacy(PASSWORD, SALT);
    expect(a).toBe(b);
  });

  it('returns hex of a 32-byte key', async () => {
    const hex = await deriveDbEncryptionKeyHex_v1_legacy(PASSWORD, SALT);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a stable golden hex for a fixed (password, salt) pair', async () => {
    // Golden regression — captured on first implementation.  Any change
    // to the legacy salt reconstruction ('db-encryption' NaN-to-zero
    // chunk handling) would shift this value and break migration for
    // every existing v1 user.  Re-computing `expected` by hand is
    // unreliable across WebCrypto implementations, so we anchor against
    // a known-good output instead and keep the bug-reproduction intent
    // in the test name.
    const actual = await deriveDbEncryptionKeyHex_v1_legacy(PASSWORD, SALT);
    expect(actual).toBe(
      'bfeeb05ab633184866e0b17f3d3615c551d22a3e8ee28328a27d5fa79f56de3c',
    );
  });
});

describe('v1 vs v2 domain separation (core security invariant)', () => {
  it('v2 and v1_legacy produce different keys for the same input', async () => {
    const v2 = await deriveDbEncryptionKeyHex_v2(PASSWORD, SALT);
    const v1Hex = await deriveDbEncryptionKeyHex_v1_legacy(PASSWORD, SALT);
    expect(v2.toString('hex')).not.toBe(v1Hex);
  });

  it('domain suffix is versioned so a future v3 cannot collide', () => {
    expect(__forTesting.DOMAIN_SUFFIX_V2).toBe('soul-upload/v2/db-enc');
    expect(__forTesting.DOMAIN_SUFFIX_V2).toMatch(/\/v\d+\//);
  });
});

describe('dekBufferToHex', () => {
  it('round-trips through Buffer.toString', () => {
    const buf = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');
    expect(dekBufferToHex(buf)).toBe('0102030405060708090a0b0c0d0e0f10');
  });
});
