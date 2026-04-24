import { z } from 'zod';
import type { StoredAccount } from './accounts-file';

// ============================================================
// SU-088 · P0-D: strict Zod whitelists for accounts/* writes.
//
// Every request body is narrowed to exactly the fields the server
// is willing to persist.  Unknown keys are stripped by Zod, which
// blocks passing through arbitrary future StoredAccount shape.
// ============================================================

const isoDate = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid ISO timestamp');

/**
 * First-time registration payload.  The caller provides the pre-computed
 * Argon2id hash + salt; the server only mechanically persists them.
 */
export const AccountCreateSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string().min(1).max(64),
    passwordHash: z.string().min(10),
    salt: z.string().min(8),
    email: z.string().email().optional(),
    createdAt: isoDate,
  })
  .strict();

/**
 * Profile update — explicitly rejects password / salt mutation so a
 * compromised session cannot silently rotate credentials.  Password
 * rotation goes through `AccountChangePasswordSchema` below.
 */
export const AccountProfileUpdateSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string().min(1).max(64).optional(),
    email: z.string().email().nullable().optional(),
  })
  .strict();

export const AccountDeleteSchema = z
  .object({ id: z.string().uuid() })
  .strict();

/**
 * Dedicated password rotation path.
 *
 * SU-ITER-089 · P1-1 · B8-5: the client no longer pre-hashes the new
 * password.  The server takes `{id, currentPassword, newPassword}` and
 * runs verify + strength-gate + Argon2id(newPassword, freshSalt) +
 * rekey-of-db internally so there is a single trusted path for
 * credential rotation.  `newPassword` is plaintext on the wire; same
 * trust model as `session/open` (localhost same-origin).
 */
export const AccountChangePasswordSchema = z
  .object({
    id: z.string().uuid(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
  })
  .strict();

export type AccountCreateInput = z.infer<typeof AccountCreateSchema>;
export type AccountProfileUpdateInput = z.infer<typeof AccountProfileUpdateSchema>;
export type AccountChangePasswordInput = z.infer<typeof AccountChangePasswordSchema>;
export type AccountDeleteInput = z.infer<typeof AccountDeleteSchema>;

// ============================================================
// Outbound sanitisers.
//
// `passwordHash` is the primary offline-crack target; it must never
// leave the server.  `failedAttempts` / `lockUntil` are internal state
// not part of the user profile.
//
// SU-ITER-089 · P1-1 · B8-4: the former residual on `salt` / `email`
// leaking through the username-lookup path is closed here.  Key
// derivation moved server-side (`deriveDbEncryptionKeyHex_v2` inside
// `session/open`), so the browser no longer needs the salt at all
// during login.  `accounts/get?username=` therefore returns the
// minimum login-gate surface only — id + lockUntil — which is enough
// to (a) route the subsequent `session/open` call and (b) render an
// immediate lockout message without a server round-trip.
// ============================================================

export interface PublicAccount {
  id: string;
  username: string;
  email?: string;
  createdAt: string;
}

/**
 * Returned by `accounts/get?username=` — the minimum-trust surface
 * needed to reach `session/open`.  Must never include `salt`,
 * `passwordHash`, `failedAttempts`, or `email` (B8-4).
 */
export interface LoginMaterial {
  id: string;
  // Surface lockUntil so the UI can hint without leaking the hash/attempts.
  lockUntil: string | null;
}

export function toPublicAccount(a: StoredAccount): PublicAccount {
  return {
    id: a.id,
    username: a.username,
    email: a.email,
    createdAt: a.createdAt,
  };
}

export function toLoginMaterial(a: StoredAccount): LoginMaterial {
  return {
    id: a.id,
    lockUntil: a.lockUntil,
  };
}
