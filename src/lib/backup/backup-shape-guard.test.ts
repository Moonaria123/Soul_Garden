// @vitest-environment jsdom
// SU-ITER-092-batch1 · Nit-4 — client-side shape guard for decrypted
// backup payloads.  The guard is deliberately shallow (top-level keys
// only); server-side Zod remains authoritative for row content.
//
// This file constructs *unencrypted* backup zips so the guard is
// exercised in isolation.  Crypto / zip round-trip is already covered
// by `backup-crypto.test.ts` and `backup-v1-restore-in-v2.test.ts`.

import { describe, it, expect } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  createBackupZip,
  type BackupManifest,
  type BackupScope,
} from './backup-format';
import {
  parseBackupPayload,
  BackupPayloadShapeError,
} from './backup-restore';

async function buildBackupFileAsync(opts: {
  scope: BackupScope;
  payload: unknown;
}): Promise<File> {
  // Reuse `createBackupZip` so the checksum is computed correctly and
  // `readBackupZip`'s integrity gate doesn't reject the fixture before
  // the shape guard runs.  Checksum / zip round-trip is covered by
  // `backup-format.test.ts`; this file tests only the payload shape
  // guard on the decrypted JSON.
  const manifest: Omit<BackupManifest, 'checksum'> = {
    version: BACKUP_FORMAT_VERSION,
    type:
      opts.scope === 'chat-only'
        ? 'chat'
        : opts.scope === 'entity-full'
          ? 'entity'
          : 'global',
    scope: opts.scope,
    appVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    encrypted: false,
  };
  const blob = await createBackupZip(manifest, JSON.stringify(opts.payload));
  return new File([blob], `fixture.soul-backup`);
}

describe('SU-092-batch1 · backup payload shape guard', () => {
  describe('happy paths', () => {
    it('accepts a well-formed chat-only payload', async () => {
      const file = await buildBackupFileAsync({
        scope: 'chat-only',
        payload: { sessions: [], messages: [] },
      });
      const { payload } = await parseBackupPayload(file);
      expect(payload).toMatchObject({ sessions: [], messages: [] });
    });

    it('accepts a well-formed entity-full payload', async () => {
      const file = await buildBackupFileAsync({
        scope: 'entity-full',
        payload: {
          entity: { id: 'ent-1', name: 'x', entityType: 'ai' },
          chat: { sessions: [], messages: [] },
          memory: {
            events: [],
            facts: [],
            summaries: [],
            relationshipSnapshots: [],
            openLoops: [],
          },
        },
      });
      const { payload } = await parseBackupPayload(file);
      expect((payload as { entity: { id: string } }).entity.id).toBe('ent-1');
    });

    it('accepts a well-formed config-only payload (userProfile null)', async () => {
      const file = await buildBackupFileAsync({
        scope: 'config-only',
        payload: {
          providers: [],
          providerModels: [],
          appConfig: [],
          userProfile: null,
        },
      });
      const { payload } = await parseBackupPayload(file);
      expect(payload).toMatchObject({ userProfile: null });
    });

    it('accepts a global (full) payload with only `entities`', async () => {
      const file = await buildBackupFileAsync({
        scope: 'full',
        payload: { entities: [] },
      });
      const { payload } = await parseBackupPayload(file);
      expect(payload).toMatchObject({ entities: [] });
    });
  });

  describe('rejections', () => {
    it('rejects a chat-only payload missing `messages`', async () => {
      const file = await buildBackupFileAsync({
        scope: 'chat-only',
        // `messages` omitted on purpose.
        payload: { sessions: [] },
      });
      await expect(parseBackupPayload(file)).rejects.toThrow(
        BackupPayloadShapeError,
      );
    });

    it('rejects an entity-full payload where `memory` is an array', async () => {
      const file = await buildBackupFileAsync({
        scope: 'entity-full',
        payload: {
          entity: { id: 'ent-1', name: 'x', entityType: 'ai' },
          chat: { sessions: [], messages: [] },
          // Arrays are `typeof 'object'` but guarded explicitly.
          memory: [],
        },
      });
      await expect(parseBackupPayload(file)).rejects.toThrow(
        /missing object field 'memory'/,
      );
    });

    it('rejects a config-only payload missing `userProfile` key entirely', async () => {
      const file = await buildBackupFileAsync({
        scope: 'config-only',
        payload: {
          providers: [],
          providerModels: [],
          appConfig: [],
          // `userProfile` key absent — nullable-but-present contract.
        },
      });
      await expect(parseBackupPayload(file)).rejects.toThrow(
        /missing key 'userProfile'/,
      );
    });

    it('rejects a global payload with neither entities nor config', async () => {
      const file = await buildBackupFileAsync({
        scope: 'full',
        payload: {},
      });
      await expect(parseBackupPayload(file)).rejects.toThrow(
        /neither 'entities' nor 'config'/,
      );
    });

    it('rejects a payload that parses to a scalar', async () => {
      const file = await buildBackupFileAsync({
        scope: 'chat-only',
        payload: 'not-an-object',
      });
      await expect(parseBackupPayload(file)).rejects.toThrow(
        /not an object/,
      );
    });
  });
});
