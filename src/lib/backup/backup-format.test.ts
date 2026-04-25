// @vitest-environment jsdom
// SU-ITER-090b · P2-10 — version migration pipeline tests.
//
// `readBackupZip` itself needs TextEncoder + crypto.subtle so the zip
// checksum math works; jsdom ships a polyfill-compatible shape, and
// node ≥ 18 provides a WebCrypto implementation under the same global
// name.  The `migrateBackupManifest` path is pure and environment-
// agnostic, but colocating the jsdom env keeps all backup tests under
// one roof in case we later exercise the zip read path end-to-end.

import { describe, it, expect } from 'vitest';
import {
  migrateBackupManifest,
  BackupVersionError,
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
} from './backup-format';

const baseManifest = (overrides: Partial<BackupManifest> = {}): BackupManifest => ({
  version: BACKUP_FORMAT_VERSION,
  type: 'chat',
  scope: 'chat-only',
  appVersion: '1.1.0.1',
  createdAt: '2026-04-19T00:00:00Z',
  checksum: 'deadbeef',
  encrypted: false,
  ...overrides,
});

describe('migrateBackupManifest', () => {
  it('returns current-version manifests untouched', () => {
    const m = baseManifest();
    const out = migrateBackupManifest(m);
    expect(out).toEqual(m);
  });

  it('rejects future versions with future_version_not_supported', () => {
    const m = baseManifest({ version: BACKUP_FORMAT_VERSION + 5 });
    try {
      migrateBackupManifest(m);
      expect.fail('expected BackupVersionError');
    } catch (err) {
      expect(err).toBeInstanceOf(BackupVersionError);
      expect((err as BackupVersionError).code).toBe('future_version_not_supported');
      expect((err as BackupVersionError).manifestVersion).toBe(BACKUP_FORMAT_VERSION + 5);
    }
  });

  it('rejects negative versions with invalid_version', () => {
    const m = baseManifest({ version: -1 });
    try {
      migrateBackupManifest(m);
      expect.fail('expected BackupVersionError');
    } catch (err) {
      expect(err).toBeInstanceOf(BackupVersionError);
      expect((err as BackupVersionError).code).toBe('invalid_version');
    }
  });

  it('rejects non-integer versions with invalid_version', () => {
    const m = baseManifest({ version: 1.5 as unknown as number });
    try {
      migrateBackupManifest(m);
      expect.fail('expected BackupVersionError');
    } catch (err) {
      expect(err).toBeInstanceOf(BackupVersionError);
      expect((err as BackupVersionError).code).toBe('invalid_version');
    }
  });

  it('rejects NaN / non-number versions with invalid_version', () => {
    const m = baseManifest({ version: 'v2' as unknown as number });
    try {
      migrateBackupManifest(m);
      expect.fail('expected BackupVersionError');
    } catch (err) {
      expect(err).toBeInstanceOf(BackupVersionError);
      expect((err as BackupVersionError).code).toBe('invalid_version');
    }
  });

  it('carries the offending version on the error for logging', () => {
    const m = baseManifest({ version: 99 });
    try {
      migrateBackupManifest(m);
    } catch (err) {
      expect((err as BackupVersionError).manifestVersion).toBe(99);
      expect((err as BackupVersionError).message).toContain('99');
    }
  });

  // SU-ITER-091-batch3 — v1 → v2 manifest migration pins the legacy
  // KDF marker so the restore flow can route on it.  These assertions
  // are the contract the backup-restore / server-derive-legacy-dek
  // code relies on.
  it('tags a v1 manifest with derivation.kdfVersion="v1" on upgrade', () => {
    const m = baseManifest({ version: 1 });
    const out = migrateBackupManifest(m);
    expect(out.version).toBe(BACKUP_FORMAT_VERSION);
    expect(out.derivation).toBeDefined();
    expect(out.derivation?.kdfVersion).toBe('v1');
    expect(out.derivation?.saltHex).toBeUndefined();
  });

  it('preserves an explicit derivation already present on a v1 manifest', () => {
    // Defensive: if a future dev ever hand-writes a v1 manifest with
    // a `derivation`, we must not clobber it during migration.
    const m = baseManifest({
      version: 1,
      derivation: { kdfVersion: 'v2', saltHex: 'deadbeef' },
    });
    const out = migrateBackupManifest(m);
    expect(out.derivation?.kdfVersion).toBe('v2');
    expect(out.derivation?.saltHex).toBe('deadbeef');
  });

  it('leaves a current-version manifest (v2) untouched', () => {
    const m = baseManifest({
      version: 2,
      derivation: { kdfVersion: 'v2', saltHex: 'abcd' },
    });
    const out = migrateBackupManifest(m);
    expect(out).toEqual(m);
  });
});
