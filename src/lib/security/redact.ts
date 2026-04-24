// SU-ITER-089 · P1-5 · Secret redaction helpers for log pipelines.
//
// Problem: two LLM-probe routes previously logged `keyPrefix: apiKey.slice(0,6)`
// which, for vendors whose keys encode routing hints in the prefix
// (e.g. `sk-proj-…`, `sk-live-…`, `xoxp-…`), leaks enough context to help an
// attacker scope leaked credentials.  The prefix also makes log grep trivial.
//
// Replacement: `secretFingerprint(secret)` returns a non-reversible SHA-256
// truncation that is deterministic for the same secret (so re-runs of the
// same call show the same token in logs) but does not expose any characters
// of the secret itself.  `redactSecret()` is a defence-in-depth helper for
// cases where developers want to log a secret field as an explicit `***`.
//
// Both helpers are pure sync utilities and safe to call on cold paths;
// `secretFingerprint` uses Node's `crypto.createHash` which is available in
// every server runtime this project targets (Node, Next.js route handlers).

import { createHash } from 'node:crypto';

const FINGERPRINT_HEX_LENGTH = 8; // 32 bits — enough to disambiguate logs

/**
 * Produce a short, deterministic, non-reversible fingerprint of a secret
 * string suitable for log correlation.  Returns `'∅'` for empty / nullish
 * inputs so log lines stay grep-friendly without crashing on undefined.
 *
 * Security properties:
 * - Irreversible (SHA-256, truncated).
 * - Length-preserving → collisions are acceptable for logging; not a
 *   substitute for authentication.
 * - Length-hiding (output is always 8 hex chars regardless of input).
 */
export function secretFingerprint(secret: string | null | undefined): string {
  if (!secret) return '∅';
  const digest = createHash('sha256').update(secret, 'utf8').digest('hex');
  return digest.slice(0, FINGERPRINT_HEX_LENGTH);
}

/**
 * Returns a canonical placeholder for redacted secret values.  Using a
 * single helper rather than a magic string keeps linters honest: if we
 * ever need to change the style (e.g. `[REDACTED]`) there is exactly one
 * site to update.
 */
export function redactSecret(): string {
  return '***';
}
