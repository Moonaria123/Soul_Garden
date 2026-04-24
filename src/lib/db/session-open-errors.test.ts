import { describe, it, expect } from 'vitest';
import {
  flattenSessionOpenError,
  isNotadbOnFirstMigrationDDL,
  sessionOpenDbErrorCode,
} from './session-open-errors';

describe('flattenSessionOpenError', () => {
  it('collects cause chain messages', () => {
    const e = new Error('outer');
    (e as Error & { cause?: Error }).cause = new Error('inner');
    const flat = flattenSessionOpenError(e);
    expect(flat.message).toContain('outer');
    expect(flat.message).toContain('inner');
  });
});

describe('sessionOpenDbErrorCode', () => {
  it('maps SQLITE_BUSY', () => {
    expect(sessionOpenDbErrorCode(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(
      'database_locked',
    );
  });

  it('maps corruption indicators', () => {
    expect(
      sessionOpenDbErrorCode(Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })),
    ).toBe('database_corrupt');
  });

  it('maps I/O and permission style errors', () => {
    expect(sessionOpenDbErrorCode(new Error('unable to open the database file'))).toBe('database_io_denied');
  });

  it('maps SQLITE_PERM via code', () => {
    expect(sessionOpenDbErrorCode(Object.assign(new Error('nope'), { code: 'SQLITE_PERM' }))).toBe(
      'database_io_denied',
    );
  });

  it('maps decrypt-related wording', () => {
    expect(sessionOpenDbErrorCode(new Error('decryption failed'))).toBe('database_decrypt_failed');
  });

  it('falls back to generic', () => {
    expect(sessionOpenDbErrorCode(new Error('something else'))).toBe('Failed to open database');
  });
});

describe('isNotadbOnFirstMigrationDDL', () => {
  it('is true for NOTADB on first migration DDL', () => {
    const e = new Error(
      'Failed query: CREATE TABLE IF NOT EXISTS schema_migrations (\n' +
        '    version INTEGER PRIMARY KEY,\n' +
        '  )\n' +
        'params:  | SQLITE_NOTADB: file is not a database | file is not a database',
    );
    Object.assign(e, { code: 'SQLITE_NOTADB' });
    expect(isNotadbOnFirstMigrationDDL(e)).toBe(true);
  });

  it('is false for NOTADB without migration context', () => {
    const e = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    expect(isNotadbOnFirstMigrationDDL(e)).toBe(false);
  });
});
