// SU-ITER-091-batch3 — Zod pre-flight tests for
// `backup/derive-legacy-dek`.
//
// The full POST handler lives in `src/app/api/db/[...path]/route.ts`
// and is exercised end-to-end by the V1 backup restore fixture test.
// Here we pin the schema's rejection surface so a hostile client can
// never get past the `.strict()` check with extra fields (e.g. a
// spoofed `saltHex`) before the handler runs the rate-limit +
// lockout pipeline.

import { describe, it, expect } from 'vitest';
import { BackupDeriveLegacyDekBody } from './route-schemas';

describe('BackupDeriveLegacyDekBody', () => {
  it('accepts a minimal valid body (userId + password)', () => {
    const ok = BackupDeriveLegacyDekBody.safeParse({
      userId: '11111111-1111-4111-8111-111111111111',
      password: 'correct-horse-battery-staple',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a body missing userId', () => {
    const r = BackupDeriveLegacyDekBody.safeParse({ password: 'pw' });
    expect(r.success).toBe(false);
  });

  it('rejects a body missing password', () => {
    const r = BackupDeriveLegacyDekBody.safeParse({ userId: 'u' });
    expect(r.success).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(
      BackupDeriveLegacyDekBody.safeParse({ userId: '', password: 'p' }).success,
    ).toBe(false);
    expect(
      BackupDeriveLegacyDekBody.safeParse({ userId: 'u', password: '' }).success,
    ).toBe(false);
  });

  // Strict-mode guards — an attacker could otherwise smuggle their
  // own `saltHex` into the request body and coerce the server into
  // deriving a DEK of their choosing.  `.strict()` drops that vector
  // by refusing the whole request.
  it('rejects extra fields (strict mode)', () => {
    const r = BackupDeriveLegacyDekBody.safeParse({
      userId: 'u',
      password: 'p',
      saltHex: 'deadbeef',
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-string types that are truthy (defence in depth)', () => {
    const r = BackupDeriveLegacyDekBody.safeParse({ userId: 123, password: 'p' });
    expect(r.success).toBe(false);
    const r2 = BackupDeriveLegacyDekBody.safeParse({ userId: 'u', password: {} });
    expect(r2.success).toBe(false);
  });

  it('enforces length ceilings on userId and password', () => {
    const longUserId = 'x'.repeat(65);
    const longPassword = 'y'.repeat(257);
    expect(
      BackupDeriveLegacyDekBody.safeParse({ userId: longUserId, password: 'p' }).success,
    ).toBe(false);
    expect(
      BackupDeriveLegacyDekBody.safeParse({ userId: 'u', password: longPassword }).success,
    ).toBe(false);
  });
});
