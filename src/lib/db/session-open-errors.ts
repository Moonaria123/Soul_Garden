/**
 * Classify libsql / SQLite errors during `session/open` so the API can return
 * stable machine codes (mapped to i18n in the browser) instead of one generic string.
 */

/**
 * Flatten `Error` / `LibsqlError` / `cause` chains into a single lowercase string
 * and the best-known driver code (e.g. SQLITE_BUSY).
 */
export function flattenSessionOpenError(err: unknown): { code: string; message: string; combinedLower: string } {
  const codes: string[] = [];
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: string; message?: string; cause?: unknown };
    if (typeof e.code === 'string' && e.code.length > 0) codes.push(e.code);
    if (typeof e.message === 'string' && e.message.length > 0) messages.push(e.message);
    current = e.cause;
  }
  if (messages.length === 0 && err instanceof Error) messages.push(err.message);
  const message = messages.join(' | ') || String(err);
  const combinedLower = message.toLowerCase();
  const code = codes[0] ?? '';
  return { code, message, combinedLower };
}

/**
 * When true, `/api/db/session/open` may include `detail` / `driverCode` in JSON for debugging.
 * Development mode enables this; production can opt in with `SU_DEV_SESSION_OPEN_DETAIL=1`.
 */
export function shouldExposeSessionOpenErrorDetail(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.SU_DEV_SESSION_OPEN_DETAIL === '1'
  );
}

/**
 * Returns an `error` field value for JSON responses from `handleSessionOpen`'s catch block.
 */
/**
 * True when the failure is SQLITE_NOTADB on the first migration bookkeeping DDL
 * (`schema_migrations`). That usually means the file is not a valid v2-encrypted
 * SQLite DB under the derived DEK (v1 payload, copied machine, corrupt file, or
 * `.db-v2-marker` without a matching DB).
 */
export function isNotadbOnFirstMigrationDDL(err: unknown): boolean {
  const { code, message, combinedLower } = flattenSessionOpenError(err);
  if (code !== 'SQLITE_NOTADB') return false;
  const mentionsMigrationTable = /\bschema_migrations\b/i.test(message);
  const looksLikeFirstDdl =
    /\bfailed query\b/i.test(combinedLower) &&
    /\bcreate\s+table\b/i.test(combinedLower);
  return mentionsMigrationTable && looksLikeFirstDdl;
}

export function sessionOpenDbErrorCode(err: unknown): string {
  const { code, combinedLower } = flattenSessionOpenError(err);

  if (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    /\b(sqlite_busy|sqlite_locked)\b/.test(combinedLower) ||
    /\b(locked|busy)\b/.test(combinedLower)
  ) {
    return 'database_locked';
  }

  if (
    code === 'SQLITE_NOTADB' ||
    code === 'SQLITE_CORRUPT' ||
    /not a database|malformed|database disk image is malformed|\bcorrupt\b/.test(combinedLower)
  ) {
    return 'database_corrupt';
  }

  if (
    code === 'SQLITE_IOERR' ||
    code === 'SQLITE_CANTOPEN' ||
    code === 'SQLITE_PERM' ||
    /eio\b|i\/o error|permission denied|access is denied|enospc|enotdir|eperm|sqlite_ioerr|sqlite_cantopen|sqlite_perm/.test(
      combinedLower,
    ) ||
    /unable to open the database file/.test(combinedLower)
  ) {
    return 'database_io_denied';
  }

  // Wrong key / unreadable ciphertext sometimes surface as generic API errors without SQLITE_* codes.
  if (
    /decrypt|decryption|cipher|authentication tag|invalid key|bad key|wrong key|hmac|aes/.test(combinedLower)
  ) {
    return 'database_decrypt_failed';
  }

  return 'Failed to open database';
}
