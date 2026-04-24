/**
 * SU-093 follow-up — `repairFalseV2MarkerAfterNotadbOnSchemaDdl` strips a false
 * `.db-v2-marker` when the active file is still v1-encrypted (v2 probe can succeed
 * on `SELECT 1` while first migration DDL hits SQLITE_NOTADB).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deriveDbEncryptionKeyHex_v1_legacy } from '@/lib/crypto/key-derivation-server';
import {
  __forTesting as connectionTesting,
  getDbPath,
  libsqlLocalFileUrl,
} from '@/lib/db/connection';
import { detectMigrationState } from '@/lib/db/migration-v2/state';
import { MARKER_FILENAME } from '@/lib/db/migration-v2/paths';
import { repairFalseV2MarkerAfterNotadbOnSchemaDdl } from '@/lib/db/migration-v2/marker';

const PASSWORD = 'correct horse battery staple';
const SALT = '0011223344556677889900aabbccddee';

describe('repairFalseV2MarkerAfterNotadbOnSchemaDdl', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'su-notadb-marker-'));
    process.env.SOUL_UPLOAD_DATA_DIR = tmp;
    connectionTesting.resetDataDirCache();
  });

  afterEach(() => {
    delete process.env.SOUL_UPLOAD_DATA_DIR;
    connectionTesting.resetDataDirCache();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('returns not_migrated_state when no v2 marker is present', async () => {
    fs.writeFileSync(getDbPath(), '');
    const r = await repairFalseV2MarkerAfterNotadbOnSchemaDdl({
      password: PASSWORD,
      saltHex: SALT,
    });
    expect(r).toEqual({ ok: false, code: 'not_migrated_state' });
  });

  it('removes the marker when a v1-encrypted db is present under a false migrated marker', async () => {
    const v1Hex = await deriveDbEncryptionKeyHex_v1_legacy(PASSWORD, SALT);
    const dbPath = getDbPath();
    const client = createClient({
      url: libsqlLocalFileUrl(dbPath),
      encryptionKey: v1Hex,
    });
    try {
      await client.execute('SELECT 1');
    } finally {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }

    fs.writeFileSync(path.join(tmp, MARKER_FILENAME), 'v2\n');
    connectionTesting.resetDataDirCache();
    expect(detectMigrationState()).toBe('migrated');

    const r = await repairFalseV2MarkerAfterNotadbOnSchemaDdl({
      password: PASSWORD,
      saltHex: SALT,
    });
    expect(r).toEqual({ ok: true });
    expect(fs.existsSync(path.join(tmp, MARKER_FILENAME))).toBe(false);
    expect(detectMigrationState()).toBe('needs-migration');
  });
});
