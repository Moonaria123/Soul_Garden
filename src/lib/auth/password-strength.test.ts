import { describe, expect, it } from 'vitest';
import {
  MIN_CATEGORIES,
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
} from './password-strength';

// SU-ITER-089 · P1-3 — pin strength rules so UI copy and server-side
// invariants stay in sync.

describe('validatePasswordStrength', () => {
  it('accepts a password that satisfies every rule', () => {
    const result = validatePasswordStrength('L0cal-Secret!!', { username: 'alice' });
    expect(result.ok).toBe(true);
  });

  it('rejects passwords shorter than the minimum length', () => {
    const result = validatePasswordStrength('Sh0rt!');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, reasons: expect.arrayContaining(['too_short']) });
  });

  it('requires at least the configured number of character categories', () => {
    // 10+ chars, only letters → 1 category, fails.
    const result = validatePasswordStrength('abcdefghij');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['not_enough_categories']),
    });
  });

  it('rejects common passwords even when length is satisfied', () => {
    // "Password123" is long enough and hits 3 categories, but is on the
    // denylist so must still fail.
    const result = validatePasswordStrength('Password123');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, reasons: expect.arrayContaining(['too_common']) });
  });

  it('rejects passwords that embed the username', () => {
    const result = validatePasswordStrength('alice12345!', { username: 'alice' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['equals_username']),
    });
  });

  it('treats symbol as a distinct category from digits/letters', () => {
    // lower + upper + symbol → 3 categories.
    const result = validatePasswordStrength('Alpha-Bravo!', { username: 'bob' });
    expect(result.ok).toBe(true);
  });

  it('ignores whitespace as a symbol category', () => {
    // Only letters + whitespace → 1 or 2 categories depending on casing.
    const result = validatePasswordStrength('hello world');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['not_enough_categories']),
    });
  });

  it('surface every failing reason in a single call', () => {
    const result = validatePasswordStrength('alice', { username: 'alice' });
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrow
    expect(result.reasons).toContain('too_short');
    expect(result.reasons).toContain('not_enough_categories');
    expect(result.reasons).toContain('equals_username');
  });

  it('exports the threshold constants the UI relies on', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(10);
    expect(MIN_CATEGORIES).toBeGreaterThanOrEqual(3);
  });
});
