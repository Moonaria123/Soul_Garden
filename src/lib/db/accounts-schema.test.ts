import { describe, it, expect } from 'vitest';
import {
  AccountCreateSchema,
  AccountProfileUpdateSchema,
  AccountChangePasswordSchema,
  AccountDeleteSchema,
  toPublicAccount,
  toLoginMaterial,
} from './accounts-schema';
import type { StoredAccount } from './accounts-file';

const fullAccount: StoredAccount = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'alice',
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$abc$def',
  salt: 'saltsaltsalt',
  email: 'alice@example.com',
  failedAttempts: 2,
  lockUntil: '2026-04-19T10:00:00.000Z',
  createdAt: '2026-04-19T09:00:00.000Z',
};

describe('AccountCreateSchema', () => {
  it('accepts a well-formed first-time registration', () => {
    const ok = AccountCreateSchema.safeParse({
      id: fullAccount.id,
      username: fullAccount.username,
      passwordHash: fullAccount.passwordHash,
      salt: fullAccount.salt,
      email: fullAccount.email,
      createdAt: fullAccount.createdAt,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unknown fields (strict mode)', () => {
    const bad = AccountCreateSchema.safeParse({
      id: fullAccount.id,
      username: fullAccount.username,
      passwordHash: fullAccount.passwordHash,
      salt: fullAccount.salt,
      createdAt: fullAccount.createdAt,
      isAdmin: true,
    });
    expect(bad.success).toBe(false);
  });

  it('rejects short hashes and missing salt', () => {
    expect(AccountCreateSchema.safeParse({
      id: fullAccount.id,
      username: fullAccount.username,
      passwordHash: 'too-short',
      salt: fullAccount.salt,
      createdAt: fullAccount.createdAt,
    }).success).toBe(false);
  });
});

describe('AccountProfileUpdateSchema', () => {
  it('accepts username / email changes', () => {
    const ok = AccountProfileUpdateSchema.safeParse({
      id: fullAccount.id,
      username: 'alice2',
      email: 'alice2@example.com',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects passwordHash / salt mutation via profile path', () => {
    const bad = AccountProfileUpdateSchema.safeParse({
      id: fullAccount.id,
      passwordHash: 'new-hash-should-not-pass',
    });
    expect(bad.success).toBe(false);
  });
});

describe('AccountChangePasswordSchema', () => {
  // SU-ITER-089 · P1-1 · B8-5: payload is now {id, currentPassword, newPassword}.
  // Argon2 hashing + rekey happens entirely server-side via runChangePassword.
  it('accepts {id, currentPassword, newPassword}', () => {
    const ok = AccountChangePasswordSchema.safeParse({
      id: fullAccount.id,
      currentPassword: 'old-pass',
      newPassword: 'NewStr0ngPass!2026',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects when currentPassword is empty', () => {
    const bad = AccountChangePasswordSchema.safeParse({
      id: fullAccount.id,
      currentPassword: '',
      newPassword: 'NewStr0ngPass!2026',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects when newPassword is empty', () => {
    const bad = AccountChangePasswordSchema.safeParse({
      id: fullAccount.id,
      currentPassword: 'old-pass',
      newPassword: '',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects legacy pre-hashed payload (newPasswordHash / newSalt)', () => {
    const legacy = AccountChangePasswordSchema.safeParse({
      id: fullAccount.id,
      currentPassword: 'old-pass',
      newPasswordHash: '$argon2id$...newhash....',
      newSalt: 'newsaltnewsalt',
    });
    // .strict() + the new shape means unknown keys now fail.
    expect(legacy.success).toBe(false);
  });
});

describe('AccountDeleteSchema', () => {
  it('rejects non-uuid ids', () => {
    expect(AccountDeleteSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('sanitisers', () => {
  it('toPublicAccount drops hash, salt and lock state', () => {
    const pub = toPublicAccount(fullAccount);
    expect(pub).toEqual({
      id: fullAccount.id,
      username: fullAccount.username,
      email: fullAccount.email,
      createdAt: fullAccount.createdAt,
    });
    // Explicit anti-leakage assertions against an untyped view.
    const opaque = pub as unknown as Record<string, unknown>;
    expect(opaque.passwordHash).toBeUndefined();
    expect(opaque.salt).toBeUndefined();
    expect(opaque.failedAttempts).toBeUndefined();
    expect(opaque.lockUntil).toBeUndefined();
  });

  // SU-ITER-089 · P1-1 · B8-4: the username-lookup surface is now the
  // minimum gate — id + lockUntil only.  Salt and email are deliberately
  // stripped because key derivation moved server-side and email is PII.
  it('toLoginMaterial exposes id + lockUntil only (B8-4 redaction)', () => {
    const lm = toLoginMaterial(fullAccount);
    expect(lm).toEqual({
      id: fullAccount.id,
      lockUntil: fullAccount.lockUntil,
    });
    const opaque = lm as unknown as Record<string, unknown>;
    expect(opaque.passwordHash).toBeUndefined();
    expect(opaque.salt).toBeUndefined();
    expect(opaque.failedAttempts).toBeUndefined();
    expect(opaque.email).toBeUndefined();
    expect(opaque.username).toBeUndefined();
    expect(opaque.createdAt).toBeUndefined();
  });
});
