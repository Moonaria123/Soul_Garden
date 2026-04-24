// ============================================================
// Key Derivation — SERVER-SIDE ONLY.
//
// SU-ITER-089 · P1-1 · DEK v1/v2 protocol migration.
//
// This module lives outside `src/lib/crypto` (which is a `'use client'`
// surface) so Next.js route handlers can import PBKDF2 helpers without
// pulling browser-only code into the server bundle.  It exposes:
//
//   - `deriveDbEncryptionKeyHex_v2(password, saltHex)` — the correct
//     post-migration derivation.  Uses domain-separated salt:
//         hex(saltHex)  ++  utf8('soul-upload/v2/db-enc')
//     and returns a `Buffer` so callers can `.fill(0)` after use.
//
//   - `deriveDbEncryptionKeyHex_v1_legacy(password, saltHex)` — the
//     byte-for-byte reproduction of the pre-migration derivation,
//     including the known bug (`'db-encryption'` treated as hex,
//     parseInt-NaN-to-zero).  Used ONLY during first-upgrade migration
//     to unlock the legacy DB file, then discarded.
//
// Both variants run in Node.js via `node:crypto`'s WebCrypto surface;
// neither touches the DOM.
// ============================================================

import { webcrypto } from 'node:crypto';
import { guardTestingHooks } from '../security/testing-hooks-guard';

/** PBKDF2 iterations for DEK derivation — unchanged between v1/v2. */
const PBKDF2_ITERATIONS = 600_000;

/**
 * Explicit domain separation constant for v2.  UTF-8 encoded and
 * appended to the hex-decoded salt bytes so the derived DEK cannot
 * collide with any other PBKDF2 output produced from the same
 * (password, saltHex) pair by accident.
 *
 * The constant is versioned so a future rotation can introduce a v3
 * without re-triggering migrations on clients that already ran v2.
 */
const DOMAIN_SUFFIX_V2 = 'soul-upload/v2/db-enc';

/** Validate that `hex` is a non-empty lowercase/uppercase hex string. */
function assertHex(hex: string, label: string): void {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`Invalid ${label}: expected even-length hex string`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * v2 — correct, domain-separated PBKDF2 derivation for the SQLCipher
 * database key.  Runs server-side; the returned Buffer should be
 * `.fill(0)`'d after it has been handed to libsql to avoid lingering
 * in the V8 heap any longer than necessary.
 *
 * @param password  Plaintext password as received over loopback POST.
 * @param saltHex   `account.salt` — 16-byte salt stored in accounts.json.
 * @returns         32-byte DEK as a Node Buffer.
 */
export async function deriveDbEncryptionKeyHex_v2(
  password: string,
  saltHex: string,
): Promise<Buffer> {
  assertHex(saltHex, 'saltHex');

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltBytes = new Uint8Array([
    ...hexToBytes(saltHex),
    ...encoder.encode(DOMAIN_SUFFIX_V2),
  ]);

  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return Buffer.from(new Uint8Array(bits));
}

/**
 * v1 legacy reproduction — required ONLY to unlock the pre-migration
 * database file during first-upgrade so its contents can be
 * re-encrypted with a v2 key.  Reproduces the exact byte sequence the
 * original client-side `deriveDbEncryptionKeyHex` fed into PBKDF2,
 * including its known bug.
 *
 * Original bug (see security-threat-model-SU-088.md · P1-1): the
 * constant `'db-encryption'` was concatenated to the hex `salt` string
 * and then split on every 2 characters and parsed as hex.  Only `'db'`
 * parses cleanly (0xdb); `'-e', 'nc', 'ry', 'pt', 'io', 'n'` all yield
 * NaN which `Uint8Array` silently coerces to 0x00.  The effective salt
 * is therefore `hex(salt) ++ [0xdb, 0x00 × 6]`.  We reproduce it here
 * faithfully so migration can decrypt legacy DB files bit-for-bit.
 *
 * Why this returns a hex string (not a Buffer)
 * --------------------------------------------
 * Every other DEK derivation in the codebase returns a `Buffer` so
 * callers can `.fill(0)` after libsql has the key.  This one returns
 * a hex string by design because its sole caller (`runV1ToV2Migration`)
 * immediately converts the hex back to a `Buffer` (`Buffer.from(hex,
 * 'hex')`) and the original Buffer is the one that gets zeroised in
 * the migration's `finally` block.
 *
 * The intermediate hex string is NOT zeroisable — strings are
 * immutable in JavaScript, and V8 may keep a copy in the string
 * internment table until the next GC.  We accept this residual risk
 * for three reasons:
 *
 *   1. The function is called exactly ONCE per device over its
 *      lifetime (first v1→v2 migration).  After that, `v2_v2` is the
 *      only derivation in play and it returns a zeroisable Buffer.
 *   2. The v1 key is derived from a password the user just typed into
 *      the migration wizard; it is provably present in many other V8
 *      structures (form state, React fibers, request body) within the
 *      same frame, so zeroing this one copy moves no needle on risk.
 *   3. Changing the return type to `Buffer` would require a breaking
 *      tweak to the migration entry and an extra `.toString('hex')`
 *      right before libsql — same exposure, more surface.
 *
 * Tracked for final removal in SU-ITER-093 alongside the rest of the
 * v1 cleanup (also see `@deprecated` note below).
 *
 * @deprecated Do not use for any new derivation.  Removal tracked in
 *             SU-ITER-093 (post-ship v1 cleanup) — once no supported
 *             install can still be on v1, this function, its tests,
 *             and the `.bak-v1` cleanup UI all go together.
 */
export async function deriveDbEncryptionKeyHex_v1_legacy(
  password: string,
  saltHex: string,
): Promise<string> {
  assertHex(saltHex, 'saltHex');

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Faithful reproduction of the original buggy construction:
  //   (saltHex + 'db-encryption').match(/.{1,2}/g).map(b => parseInt(b, 16))
  // Uint8Array swallows NaN -> 0, so we must do the same.
  const bugged = saltHex + 'db-encryption';
  const chunks = bugged.match(/.{1,2}/g) ?? [];
  const saltBytes = new Uint8Array(
    chunks.map((chunk) => {
      const parsed = parseInt(chunk, 16);
      return Number.isNaN(parsed) ? 0 : parsed & 0xff;
    }),
  );

  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return Buffer.from(new Uint8Array(bits)).toString('hex');
}

/**
 * Convert a DEK Buffer to its hex representation for libsql's
 * `encryptionKey` config field.  Kept as a dedicated helper so callers
 * never accidentally drop the Buffer and retain the hex string alone
 * (the Buffer is zeroisable, the hex string is not).
 */
export function dekBufferToHex(buf: Buffer): string {
  return buf.toString('hex');
}

/**
 * Test-only export — exposes the v2 domain separator so unit tests can
 * assert the derivation is stable across releases without duplicating
 * the constant literal.
 */
export const __forTesting = guardTestingHooks('crypto/key-derivation-server', {
  DOMAIN_SUFFIX_V2,
  PBKDF2_ITERATIONS,
});
