'use client';

import { z } from 'zod';
import type { EncryptedPayload } from '@/types';
import { encrypt, decrypt } from '@/lib/crypto';
import { importDEKFromRawHexOneShot } from '@/lib/crypto/key-derivation';
import { requireDEK } from '@/lib/crypto/reunlock';

// ============================================================
// Backup Encryption / Decryption
// Wraps the existing AES-GCM crypto module for backup payloads.
// requireDEK() triggers the ReUnlockDialog if the DEK is absent
// (e.g. after a page refresh without "Remember this tab").
//
// SU-ITER-089 · P1-7 — `decryptPayload` consumes user-supplied JSON
// from imported backup files.  Validate the shape **before** feeding
// it into WebCrypto so a malformed or attacker-crafted blob surfaces
// as a clear structural error rather than an opaque `OperationError`,
// and so fields that are not strings never reach `atob()` / GCM.
// ============================================================

// Base64 character set: A-Z a-z 0-9 + / = (padding).  We also accept
// the URL-safe variant (`-` `_`) because some export libraries emit
// that form.  Empty strings are explicitly disallowed because an empty
// IV would immediately fail GCM, and surfacing "missing iv" is clearer
// than GCM's generic decrypt error.
const base64Like = z
  .string()
  .min(1, 'base64 field must not be empty')
  .regex(/^[A-Za-z0-9+/=_-]+$/, 'base64 field contains invalid characters');

/**
 * Structural validator for an `EncryptedPayload` coming from an
 * untrusted source (imported backup file).  `.strict()` so unknown
 * keys are rejected — this stops polyglot files from smuggling extra
 * fields that future code might accidentally trust.
 */
export const EncryptedPayloadSchema = z
  .object({
    ciphertext: base64Like,
    iv: base64Like,
    // Backups written before salt was exposed don't carry one; keep it
    // optional but enforce the same character-set constraints when
    // present.
    salt: base64Like.optional(),
  })
  .strict();

export class BackupPayloadShapeError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BackupPayloadShapeError';
  }
}

export async function encryptPayload(payloadJson: string): Promise<string> {
  const dek = await requireDEK();
  const encrypted: EncryptedPayload = await encrypt(payloadJson, dek);
  return JSON.stringify(encrypted);
}

/**
 * Shared JSON + Zod pre-flight for backup payloads.  Keeps
 * `decryptPayload` (session DEK path) and `decryptPayloadWithDekHex`
 * (legacy one-shot DEK path) on identical validation semantics so
 * neither accidentally lets a malformed or attacker-crafted blob
 * reach `atob()` / GCM before the other does.
 */
function parseEncryptedJson(encryptedJson: string): EncryptedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch (err) {
    throw new BackupPayloadShapeError('backup payload is not valid JSON', [], {
      cause: err,
    });
  }

  const result = EncryptedPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new BackupPayloadShapeError(
      'backup payload failed structural validation',
      result.error.issues,
    );
  }
  return result.data;
}

/**
 * Decrypt a backup payload using the current session DEK.  Throws
 * `BackupPayloadShapeError` if the outer JSON structure is invalid —
 * this is a defence-in-depth layer so a corrupt or hostile backup
 * file never reaches `atob` / GCM.
 *
 * Used for the v2 manifest path where the backup was encrypted with
 * the user's current-KDF DEK (post-migration session DEK).
 */
export async function decryptPayload(encryptedJson: string): Promise<string> {
  const dek = await requireDEK();
  const payload = parseEncryptedJson(encryptedJson);
  return decrypt(payload, dek);
}

/**
 * SU-ITER-091-batch3 — decrypt a backup payload using an explicit
 * hex-encoded DEK supplied by the caller, bypassing `requireDEK()`.
 *
 * Exists so the V1 compatibility path can use a one-shot DEK
 * derived server-side via `deriveDbEncryptionKeyHex_v1_legacy`
 * (from the user's password + the account's salt) without
 * polluting the session DEK slot.  The caller is expected to
 * hold the hex string for as little time as possible and MUST NOT
 * persist it; we do NOT cache it here.
 *
 * Security invariants:
 *   - `dekHex` is validated by `importDEKFromRawHexOneShot` (64
 *     lowercase hex chars → 32 bytes).  A bad DEK surfaces as a
 *     structural error rather than silently becoming some other key.
 *   - SU-ITER-092-batch3 · A1-N3 — the CryptoKey is pinned as
 *     **non-extractable**: the raw 32 bytes cannot leak back through
 *     `crypto.subtle.exportKey`, shrinking the blast radius if a
 *     future caller ever mishandles the returned handle.  This flow
 *     is one-shot by construction (used only during V1 backup
 *     restore), so giving up "Remember this tab" re-persistability
 *     costs nothing.
 *   - `parseEncryptedJson` runs before the DEK touches GCM so a
 *     malformed payload can never be "decrypted".
 *   - On GCM failure the underlying `crypto.subtle.decrypt`
 *     throws; we surface that error untouched so callers never
 *     mistake a failed legacy decrypt for a plaintext fallback.
 */
export async function decryptPayloadWithDekHex(
  encryptedJson: string,
  dekHex: string,
): Promise<string> {
  const payload = parseEncryptedJson(encryptedJson);
  const dek = await importDEKFromRawHexOneShot(dekHex);
  return decrypt(payload, dek);
}
