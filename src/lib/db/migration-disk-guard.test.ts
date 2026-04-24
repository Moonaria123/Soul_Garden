import { describe, it, expect, vi, afterEach } from 'vitest';
import * as connection from './connection';
import { releaseAllLibsqlSessionsBeforeDiskMigration } from './migration-disk-guard';

describe('migration-disk-guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releaseAllLibsqlSessionsBeforeDiskMigration delegates to closeAllDatabases', () => {
    const spy = vi.spyOn(connection, 'closeAllDatabases');
    releaseAllLibsqlSessionsBeforeDiskMigration();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
