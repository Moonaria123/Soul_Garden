'use client';

// ============================================================
// Key Derivation — PBKDF2 for DEK (Argon2id lives in password-hash.ts
// so it can be imported from both Node API routes and Browser code).
// FR-410: Password hash only, never store plaintext
// FR-411: DEK derived from password, memory-only
// ============================================================

// Re-export password hashing helpers so existing browser callers keep working.
export { hashPassword, verifyPassword } from './password-hash';

/** PBKDF2 iterations for DEK derivation */
const PBKDF2_ITERATIONS = 600_000;

/**
 * Derive a Data Encryption Key (DEK) from the password using PBKDF2.
 * The DEK is an AES-256-GCM CryptoKey that lives ONLY in memory.
 *
 * @param password User's plaintext password
 * @param salt 16-byte salt (hex string) — same salt stored with the account
 * @returns CryptoKey for AES-256-GCM operations
 */
export async function deriveEncryptionKey(
  password: string,
  salt: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // SU-ITER-090a · P2-12 — explicit length + charset guard before
  // `.match()!`.  A corrupted accounts.json entry or a malformed salt
  // from the server would otherwise crash here with an opaque
  // "Cannot read properties of null (reading 'map')" error.
  if (salt.length === 0 || salt.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(salt)) {
    throw new Error('Invalid salt hex (expected even-length hex string)');
  }
  const saltPairs = salt.match(/.{1,2}/g);
  if (!saltPairs) {
    // Defensive — guard above guarantees this branch is unreachable.
    throw new Error('Invalid salt hex');
  }
  const saltBytes = new Uint8Array(saltPairs.map((byte) => parseInt(byte, 16)));

  // Import password as raw key material for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES-256-GCM key.
  // extractable=true so we can optionally persist the raw bytes to
  // sessionStorage when the user opts in via "Remember this tab" (SU-087).
  // When not persisted, the key still only lives in this module's closure.
  const dek = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  return dek;
}

/**
 * Decode a 64-hex DEK string into a 32-byte `Uint8Array` after full
 * charset + length validation.  Extracted as a helper so the two public
 * import entry points (`importDEKFromRawHex` · extractable + one-shot ·
 * non-extractable) share identical input validation without duplicating
 * the P2-12 `.match` invariant guard.
 */
function decodeDekHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== 64) {
    throw new Error('Invalid DEK hex');
  }
  // SU-ITER-090a · P2-12 — charset+length guard above guarantees `.match`
  // returns a non-null array of 32 pairs.  Use an explicit invariant
  // instead of `!` so the SU-092 eslint escalation does not trip.
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) throw new Error('Invalid DEK hex');
  return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
}

/**
 * Re-import a raw DEK (hex-encoded) into an **extractable** AES-256-GCM
 * `CryptoKey`.  Used to restore the client-side DEK on page refresh when
 * the user enabled "Remember this tab" (SU-087): the same key later has
 * to round-trip through `exportDEKHex()` → `sessionStorage` → next
 * session, so `extractable: true` is load-bearing for that flow.
 *
 * **Do not use this for transient one-shot decryption** (e.g. V1 backup
 * restoration); use {@link importDEKFromRawHexOneShot} instead — it
 * pins `extractable: false` so the raw bytes cannot be re-exported from
 * the CryptoKey handle even if a subsequent bug tries.
 */
export async function importDEKFromRawHex(hex: string): Promise<CryptoKey> {
  const raw = decodeDekHex(hex);
  return crypto.subtle.importKey(
    'raw',
    // SU-ITER-091-batch2 P3-04 — `Uint8Array` and `ArrayBufferLike`
    // widened across the decoder helper; the runtime is identical, so
    // cast to the DOM-typed alias rather than restructure the body.
    raw as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * SU-ITER-092-batch3 · A1-N3 — one-shot, **non-extractable** variant of
 * {@link importDEKFromRawHex}.  The resulting `CryptoKey` can only
 * `encrypt` / `decrypt`; `crypto.subtle.exportKey` will reject.  Use
 * this for V1 backup restoration (`decryptPayloadWithDekHex`) and any
 * other path that decrypts with a hex DEK once and throws the key
 * away.  Narrowing `extractable` shrinks the attack surface: a
 * subsequent code bug that mishandles the returned key cannot
 * accidentally leak the raw 32 bytes back into an export path.
 *
 * Tradeoff: this key handle is **not** compatible with the "Remember
 * this tab" persistence flow; for that path you MUST use the
 * extractable variant above.
 */
export async function importDEKFromRawHexOneShot(hex: string): Promise<CryptoKey> {
  const raw = decodeDekHex(hex);
  return crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// SU-ITER-090a · P2-12 — removed the deprecated client-side
// `deriveDbEncryptionKeyHex` (buggy v1 derivation).  It had no remaining
// call sites in `src/`; the authoritative v1 bug reproduction lives
// server-side in `@/lib/crypto/key-derivation-server` ::
// `deriveDbEncryptionKeyHex_v1_legacy` and is golden-tested there.
// The `.bak-v1` cleanup UI and full v1-artefact removal continue to
// be tracked under SU-ITER-093.
