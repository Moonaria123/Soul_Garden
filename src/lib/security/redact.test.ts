import { describe, expect, it } from 'vitest';
import { redactSecret, secretFingerprint } from './redact';

// SU-ITER-089 · P1-5 — guarantee fingerprint is stable, non-reversible,
// length-hiding, and safe on missing inputs.

describe('secretFingerprint', () => {
  it('is deterministic for the same secret', () => {
    const secret = 'sk-proj-abc123xyz789';
    expect(secretFingerprint(secret)).toBe(secretFingerprint(secret));
  });

  it('differs for distinct secrets', () => {
    const a = secretFingerprint('sk-proj-aaaaaa');
    const b = secretFingerprint('sk-proj-bbbbbb');
    expect(a).not.toBe(b);
  });

  it('hides the original prefix', () => {
    const key = 'sk-proj-super-secret-key';
    const fp = secretFingerprint(key);
    expect(fp).not.toContain('sk');
    expect(fp).not.toContain('proj');
    expect(fp).not.toContain('super');
  });

  it('produces a fixed-length hex token (length-hiding)', () => {
    const short = secretFingerprint('x');
    const long = secretFingerprint('x'.repeat(256));
    expect(short).toHaveLength(8);
    expect(long).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(short)).toBe(true);
    expect(/^[0-9a-f]{8}$/.test(long)).toBe(true);
  });

  it('returns a sentinel for nullish or empty inputs', () => {
    expect(secretFingerprint('')).toBe('∅');
    expect(secretFingerprint(null)).toBe('∅');
    expect(secretFingerprint(undefined)).toBe('∅');
  });
});

describe('redactSecret', () => {
  it('returns a stable placeholder', () => {
    expect(redactSecret()).toBe('***');
  });
});
