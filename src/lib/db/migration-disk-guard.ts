// SU-093 — single choke-point for evicting in-process libsql sessions before
// any migration / repair path touches `soul-upload.db` on disk.  Keeps the
// contract testable without importing the full Next route module.

import { closeAllDatabases } from './connection';

/**
 * Evict every live DB session so short-lived probes and migration renames
 * do not contend with a stale handle (Windows file-lock / SQLITE_BUSY).
 */
export function releaseAllLibsqlSessionsBeforeDiskMigration(): void {
  closeAllDatabases();
}
