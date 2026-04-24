/**
 * SU-ITER-092-batch2 · crypto coverage — `password-hash.ts` sat at 14 %
 * statement coverage because the existing client-side jsdom tests
 * couldn't exercise the real Argon2id path.  These tests run in the
 * default node environment where `hash-wasm` works directly and the
 * Web Crypto `getRandomValues` is available via Node 18+.
 *
 * Argon2id is deliberately slow (65 MB memory, 3 iterations) so we
 * keep each test to a single hash / verify cycle; the suite still
 * completes in ~1 s locally and is a regression net for the
 * `accounts/put` + `session/open` verification path.
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password-hash';

describe('hashPassword / verifyPassword (Argon2id · node environment)', () => {
  it('produces an encoded hash + hex salt and verifies against the original password', async () => {
    const { hash, salt } = await hashPassword('correct-horse-battery-staple');

    // Argon2id encoded format starts with `$argon2id$v=19$...`.
    expect(hash).toMatch(/^\$argon2id\$/);
    // 16-byte salt → 32 hex chars.
    expect(salt).toMatch(/^[0-9a-f]{32}$/);

    const ok = await verifyPassword('correct-horse-battery-staple', hash);
    expect(ok).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { hash } = await hashPassword('right-password');
    const ok = await verifyPassword('wrong-password', hash);
    expect(ok).toBe(false);
  });

  it('produces different salts (and therefore different hashes) on repeated calls', async () => {
    const a = await hashPassword('pw');
    const b = await hashPassword('pw');
    expect(a.salt).not.toEqual(b.salt);
    expect(a.hash).not.toEqual(b.hash);
  });
});
