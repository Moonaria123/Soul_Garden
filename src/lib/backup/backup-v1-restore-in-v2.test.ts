// @vitest-environment jsdom
// SU-ITER-091-batch3 — V1 backup compatibility end-to-end fixture.
//
// Exercises `parseBackupPayload` on a synthesized v1-era `.soul-backup`
// being imported on a v2 install.  The fixture:
//   1. Derives a "legacy" (v1-style) DEK hex — stand-in for what the
//      server would have produced via `deriveDbEncryptionKeyHex_v1
//      _legacy` back in the v1 era.  We treat it as an opaque 32-byte
//      key for the purposes of this test; the actual PBKDF2 → hex
//      pipeline is covered by `key-derivation-server.test.ts`.
//   2. Encrypts a payload with that legacy DEK.
//   3. Wraps manifest (version=1, encrypted=true) + payload.json into
//      a zip via `createBackupZip`.  Emulating the exact v1 write
//      path is unnecessary — `readBackupZip` routes through
//      `migrateBackupManifest`, which is what actually flags the
//      legacy kdf marker.
//   4. Re-reads the zip through `parseBackupPayload` with a mocked
//      `deriveLegacyBackupDek` (returning our legacy hex) and a
//      `legacyPasswordProvider` that collects a password and forwards
//      it.  Asserts the payload decrypts cleanly.
//   5. Tests the error surface: missing provider, cancelled prompt,
//      server invalid_credentials, and dual-path isolation (v1 DEK
//      must never decrypt a v2-encoded blob and vice versa).
//
// No real network, no real auth.  `dbClient.deriveLegacyBackupDek` is
// vi.mocked so the test is hermetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { encrypt } from '@/lib/crypto';
import { importDEKFromRawHex } from '@/lib/crypto/key-derivation';
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
} from './backup-format';
import {
  parseBackupPayload,
  V1BackupPasswordRequiredError,
  V1BackupDeriveFailedError,
  type LegacyPasswordProvider,
} from './backup-restore';
import * as dbClient from '@/lib/db/db-client';

// 32-byte hex keys used as stand-ins for the v1 / v2 DEKs.  Bit
// pattern is irrelevant; what matters is that they are distinct and
// both importable as AES-GCM keys.
const LEGACY_V1_DEK_HEX =
  '11111111222222223333333344444444555555556666666677777777aaaaaaaa';
const CURRENT_V2_DEK_HEX =
  '99999999aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff00000000';

const FIXTURE_USER_ID = '11111111-1111-4111-8111-111111111111';
const FIXTURE_PASSWORD = 'correct-horse-battery-staple';

async function encryptWith(hexKey: string, plaintext: string): Promise<string> {
  const key = await importDEKFromRawHex(hexKey);
  const payload = await encrypt(plaintext, key);
  return JSON.stringify(payload);
}

async function computeChecksum(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function writeV1Zip(
  innerPayloadJson: string,
  overrides: Partial<BackupManifest> = {},
): Promise<File> {
  const checksum = await computeChecksum(innerPayloadJson);
  const manifest: BackupManifest = {
    version: 1,
    type: 'chat',
    scope: 'chat-only',
    appVersion: '0.0.9',
    createdAt: '2026-04-01T00:00:00Z',
    checksum,
    encrypted: true,
    ...overrides,
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('payload.json', innerPayloadJson);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'fixture-v1.soul-backup', {
    type: 'application/zip',
  });
}

// Mock `deriveLegacyBackupDek` so the test stays hermetic.  Errors
// from the real fetch pipeline are reproduced via
// `DbClientError(code, status, data, message)`.
vi.mock('@/lib/db/db-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/db-client')>();
  return {
    ...actual,
    deriveLegacyBackupDek: vi.fn(),
  };
});

// Stub `requireDEK` so the "v2 path" branch in parseBackupPayload
// never needs a real session.  Each test that exercises a v2 file
// configures the return value explicitly.
vi.mock('@/lib/crypto/reunlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto/reunlock')>();
  return {
    ...actual,
    requireDEK: vi.fn(),
  };
});

const mockedDerive = vi.mocked(dbClient.deriveLegacyBackupDek);
let requireDEKMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockedDerive.mockReset();
  const reunlock = await import('@/lib/crypto/reunlock');
  requireDEKMock = vi.mocked(reunlock.requireDEK) as unknown as ReturnType<typeof vi.fn>;
  requireDEKMock.mockReset();
});

describe('V1 backup restore on a v2 install', () => {
  it('decrypts a v1 backup via the legacy DEK hex returned by the server', async () => {
    const innerPayload = JSON.stringify({ sessions: [], messages: [] });
    const encrypted = await encryptWith(LEGACY_V1_DEK_HEX, innerPayload);
    const file = await writeV1Zip(encrypted);

    mockedDerive.mockResolvedValueOnce({
      ok: true,
      dekHex: LEGACY_V1_DEK_HEX,
      saltHex: 'abcd1234',
    });

    const providerCalls: Array<{ userId: string }> = [];
    const legacyPasswordProvider: LegacyPasswordProvider = async () => {
      providerCalls.push({ userId: FIXTURE_USER_ID });
      return { userId: FIXTURE_USER_ID, password: FIXTURE_PASSWORD };
    };

    const { manifest, payload } = await parseBackupPayload(file, {
      legacyPasswordProvider,
    });

    // The manifest was migrated v1 → v2 and tagged with the legacy
    // KDF marker.  This is the contract the UI + server rely on.
    expect(manifest.version).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.derivation?.kdfVersion).toBe('v1');

    // The provider was called exactly once with the manifest that
    // triggered the prompt.
    expect(providerCalls).toEqual([{ userId: FIXTURE_USER_ID }]);
    expect(mockedDerive).toHaveBeenCalledTimes(1);
    expect(mockedDerive).toHaveBeenCalledWith(FIXTURE_USER_ID, FIXTURE_PASSWORD);

    // The payload round-tripped cleanly — no stray null/garbage path.
    expect(payload).toEqual({ sessions: [], messages: [] });

    // The current session DEK (v2) was never touched on the v1 path.
    expect(requireDEKMock).not.toHaveBeenCalled();
  });

  it('throws V1BackupPasswordRequiredError when no provider is supplied', async () => {
    const encrypted = await encryptWith(
      LEGACY_V1_DEK_HEX,
      JSON.stringify({ sessions: [], messages: [] }),
    );
    const file = await writeV1Zip(encrypted);

    await expect(parseBackupPayload(file)).rejects.toBeInstanceOf(
      V1BackupPasswordRequiredError,
    );
    expect(mockedDerive).not.toHaveBeenCalled();
  });

  it('throws V1BackupPasswordRequiredError when the user cancels the prompt', async () => {
    const encrypted = await encryptWith(
      LEGACY_V1_DEK_HEX,
      JSON.stringify({ sessions: [], messages: [] }),
    );
    const file = await writeV1Zip(encrypted);

    const legacyPasswordProvider: LegacyPasswordProvider = async () => null;

    await expect(
      parseBackupPayload(file, { legacyPasswordProvider }),
    ).rejects.toBeInstanceOf(V1BackupPasswordRequiredError);
    // Provider was called but server derivation was skipped — we
    // never leak a password off-device when the user cancels.
    expect(mockedDerive).not.toHaveBeenCalled();
  });

  it('wraps a DbClientError from deriveLegacyBackupDek in V1BackupDeriveFailedError with the server code', async () => {
    const encrypted = await encryptWith(
      LEGACY_V1_DEK_HEX,
      JSON.stringify({ sessions: [], messages: [] }),
    );
    const file = await writeV1Zip(encrypted);

    mockedDerive.mockRejectedValueOnce(
      new dbClient.DbClientError('invalid_credentials', 401, {
        error: 'invalid_credentials',
      }),
    );

    const err = await parseBackupPayload(file, {
      legacyPasswordProvider: async () => ({
        userId: FIXTURE_USER_ID,
        password: 'wrong-password',
      }),
    }).catch((e) => e);

    expect(err).toBeInstanceOf(V1BackupDeriveFailedError);
    expect((err as V1BackupDeriveFailedError).code).toBe('invalid_credentials');
  });

  // Dual-path KEK isolation: the v1 and v2 DEKs are different, so a
  // v2 session DEK must NOT decrypt a v1 payload and vice versa.  If
  // they ever accidentally aliased (e.g. via a stray salt reuse), the
  // test would surface as a failing assertion here.
  it('does NOT silently decrypt a v1 blob with the current session DEK (dual-path isolation)', async () => {
    const encrypted = await encryptWith(
      LEGACY_V1_DEK_HEX,
      JSON.stringify({ sessions: [], messages: [] }),
    );

    // Build the zip as a v2 manifest (kdfVersion='v2') so
    // parseBackupPayload takes the current-session branch — which
    // will try the v2 DEK and MUST fail because the blob was
    // encrypted with the legacy DEK.
    const file = await writeV1Zip(encrypted, {
      version: BACKUP_FORMAT_VERSION,
      derivation: { kdfVersion: 'v2' },
    });

    const v2Dek = await importDEKFromRawHex(CURRENT_V2_DEK_HEX);
    requireDEKMock.mockResolvedValueOnce(v2Dek);

    await expect(parseBackupPayload(file)).rejects.toThrow();
    // The server endpoint must not have been called — we took the
    // v2 path and failed loudly rather than silently falling back
    // to v1.
    expect(mockedDerive).not.toHaveBeenCalled();
  });

  it('does NOT silently decrypt a v2 blob with a legacy DEK (dual-path isolation, reversed)', async () => {
    // v2-encoded blob + v1-marked manifest would be a hostile /
    // confused file.  parseBackupPayload still routes on the marker,
    // so the legacy DEK returned by the server cannot decrypt the
    // v2 blob and the import fails loudly.
    const v2EncryptedInner = await encryptWith(
      CURRENT_V2_DEK_HEX,
      JSON.stringify({ sessions: [], messages: [] }),
    );
    const file = await writeV1Zip(v2EncryptedInner);

    mockedDerive.mockResolvedValueOnce({
      ok: true,
      dekHex: LEGACY_V1_DEK_HEX,
      saltHex: 'abcd1234',
    });

    await expect(
      parseBackupPayload(file, {
        legacyPasswordProvider: async () => ({
          userId: FIXTURE_USER_ID,
          password: FIXTURE_PASSWORD,
        }),
      }),
    ).rejects.toThrow();
  });

  it('takes the v2 session-DEK path when manifest.kdfVersion is v2 (no provider call)', async () => {
    const innerPayload = JSON.stringify({ sessions: [], messages: [] });
    const encrypted = await encryptWith(CURRENT_V2_DEK_HEX, innerPayload);
    const file = await writeV1Zip(encrypted, {
      version: BACKUP_FORMAT_VERSION,
      derivation: { kdfVersion: 'v2' },
    });

    const v2Dek = await importDEKFromRawHex(CURRENT_V2_DEK_HEX);
    requireDEKMock.mockResolvedValueOnce(v2Dek);

    const providerSpy = vi.fn();
    const legacyPasswordProvider: LegacyPasswordProvider = async (input) => {
      providerSpy(input);
      return null;
    };

    const { manifest, payload } = await parseBackupPayload(file, {
      legacyPasswordProvider,
    });

    expect(manifest.derivation?.kdfVersion).toBe('v2');
    expect(payload).toEqual({ sessions: [], messages: [] });
    expect(providerSpy).not.toHaveBeenCalled();
    expect(mockedDerive).not.toHaveBeenCalled();
    expect(requireDEKMock).toHaveBeenCalledTimes(1);
  });
});
