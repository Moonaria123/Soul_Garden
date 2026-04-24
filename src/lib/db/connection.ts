import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';
import { guardTestingHooks } from '../security/testing-hooks-guard';
import { hiddenRequire as _require } from '../utils/hidden-require';

// ============================================================
// Database Connection Manager (server-side only)
// Manages encrypted libsql database connections per session.
//
// Node.js builtins (fs, path, os) resolved via `hiddenRequire`
// (see src/lib/utils/hidden-require.ts) so Turbopack's NFT tracer
// does not pull the entire project tree into the deployment bundle.
// ============================================================

let _dataDir: string | null = null;

function findProjectRoot(): string {
  const path = _require('path') as typeof import('path');
  const fs = _require('fs') as typeof import('fs');

  // 1. Walk up from this compiled file to find package.json (Next/Turbopack
  // can nest server chunks deeper than older 10-level heuristics allowed).
  let dir = __dirname;
  for (let i = 0; i < 25; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Try cwd as fallback (works in normal dev mode)
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) return cwd;

  // 3. Last resort: user home directory
  const os = _require('os') as typeof import('os');
  return os.homedir();
}

/**
 * Absolute path to the app package root (directory containing package.json).
 * Shared with {@link resolveDataDir} and `migration.ts` drizzle discovery so
 * data dir and SQL migrations resolve to the same tree under Next dev/start.
 */
export function getProjectRoot(): string {
  return findProjectRoot();
}

function resolveDataDir(): string {
  if (_dataDir) return _dataDir;
  const path = _require('path') as typeof import('path');
  const fs = _require('fs') as typeof import('fs');
  const dir = process.env.SOUL_UPLOAD_DATA_DIR || path.resolve(findProjectRoot(), '.soul-upload-data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  _dataDir = dir;
  return dir;
}

export function getDataDir(): string {
  return resolveDataDir();
}

export function getDbPath(): string {
  const path = _require('path') as typeof import('path');
  return path.resolve(resolveDataDir(), 'soul-upload.db');
}

/**
 * Build a libsql-compatible `file:` URL from an absolute filesystem path.
 * On Windows, `` `file:${path}` `` with backslashes is not a valid URL and
 * embedded libsql can fail to open the database; `pathToFileURL` yields
 * `file:///C:/...` with forward slashes (RFC 8089).
 */
export function libsqlLocalFileUrl(absolutePath: string): string {
  const { pathToFileURL } = _require('url') as typeof import('url');
  return pathToFileURL(absolutePath).href;
}

interface DbSession {
  client: Pick<Client, 'close'>;
  db: LibSQLDatabase<typeof schema>;
  userId: string;
  /** Absolute cap anchor; never mutated after openDatabase. */
  createdAt: number;
  /** Last successful API hit; refreshed on getDatabase / getSessionUserId. */
  lastAccessAt: number;
  /**
   * SU-ITER-089 · P1-1 · M-NEW (security-reviewer round 2).
   * Zeroisable copy of the DB DEK.  Stored as a Node `Buffer` so
   * `evict()` can `.fill(0)` it deterministically — V8 `string`
   * interning would otherwise leave the hex key in the heap until GC.
   * `null` for legacy / test stub sessions that never received a key.
   */
  encryptionKey: Buffer | null;
}

const sessions = new Map<string, DbSession>();

// ============================================================
// SU-ITER-089 · P1-6 · dual-line session TTL.
//
// Two independent deadlines guard every session; whichever fires first
// wins:
//   1. IDLE_TTL_MS — sliding window that resets on each `getDatabase` /
//      `getSessionUserId` hit.  Protects against abandoned browser
//      tabs.
//   2. ABSOLUTE_TTL_MS — hard cap anchored at `createdAt`.  No amount
//      of activity can extend a session past this bound; protects
//      against indefinitely refreshed sessions (e.g. polling bots).
//
// Both are enforced in two places:
//   (a) eagerly on every access, so a stale token returns `null`
//       immediately instead of the caller seeing a valid db until the
//       next cleanup tick;
//   (b) lazily in `cleanupExpiredSessions` so forgotten tokens free
//       their libsql handle even if nobody tries to use them again.
// ============================================================
export const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2h idle window
export const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12h hard cap
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 min

function isExpired(session: DbSession, now: number): boolean {
  return (
    now - session.createdAt > ABSOLUTE_TTL_MS ||
    now - session.lastAccessAt > IDLE_TTL_MS
  );
}

function evict(token: string, session: DbSession): void {
  try {
    session.client.close();
  } catch {
    // Swallow close errors — the session is already being discarded and
    // a throwing close() must not leave the map entry behind.
  }
  // Zeroise the DEK buffer we still own.  libsql's internal copy is
  // outside our reach (Rust-owned), but scrubbing the V8-heap side
  // removes one clearly-identified plaintext DEK replica.
  if (session.encryptionKey) {
    session.encryptionKey.fill(0);
    session.encryptionKey = null;
  }
  sessions.delete(token);
}

/**
 * Open (or rebind) an encrypted libsql session.
 *
 * The caller MUST pass `encryptionKey` as a `Buffer` so this module
 * can zero it deterministically when the session is evicted.  The
 * Buffer's contents are read once to hand libsql a hex string, after
 * which the session retains ownership of the Buffer — callers must
 * NOT mutate or fill(0) it themselves after handing it over.
 */
export function openDatabase(
  sessionToken: string,
  encryptionKey: Buffer,
  userId: string,
): LibSQLDatabase<typeof schema> {
  const existing = sessions.get(sessionToken);
  if (existing) {
    // Re-opening an existing token with fresh credentials touches the
    // idle window but intentionally preserves `createdAt` so the
    // absolute cap cannot be bypassed by a reconnect storm.  We DO
    // swap in the new key buffer so the caller keeps ownership of a
    // single canonical copy; the old buffer is zeroised.
    if (existing.encryptionKey && existing.encryptionKey !== encryptionKey) {
      existing.encryptionKey.fill(0);
    }
    existing.encryptionKey = encryptionKey;
    existing.lastAccessAt = Date.now();
    return existing.db;
  }

  const dbPath = getDbPath();
  const client = createClient({
    url: libsqlLocalFileUrl(dbPath),
    encryptionKey: encryptionKey.toString('hex'),
  });
  const db = drizzle(client, { schema });

  // SU-ITER-090b · P2-11 — enable per-connection FK enforcement.
  // sqlite's `PRAGMA foreign_keys` is a per-connection flag that
  // defaults to OFF; if we leave it unset, the FK declared on
  // `chat_messages.entity_id` (and the other FKs throughout the
  // schema) won't fire at runtime.  libsql serialises statements
  // on a single connection in issue order, so firing this before
  // returning guarantees subsequent queries see FK enforcement.
  // We don't await because `openDatabase` is sync; any
  // application-level query must go through the same client after
  // this point and will therefore observe the pragma.
  void client.execute('PRAGMA foreign_keys = ON');

  const now = Date.now();
  sessions.set(sessionToken, {
    client,
    db,
    userId,
    createdAt: now,
    lastAccessAt: now,
    encryptionKey,
  });
  return db;
}

export function getDatabase(sessionToken: string): LibSQLDatabase<typeof schema> | null {
  const session = sessions.get(sessionToken);
  if (!session) return null;
  const now = Date.now();
  if (isExpired(session, now)) {
    evict(sessionToken, session);
    return null;
  }
  session.lastAccessAt = now;
  return session.db;
}

export function getSessionUserId(sessionToken: string): string | null {
  const session = sessions.get(sessionToken);
  if (!session) return null;
  const now = Date.now();
  if (isExpired(session, now)) {
    evict(sessionToken, session);
    return null;
  }
  session.lastAccessAt = now;
  return session.userId;
}

export function closeDatabase(sessionToken: string): void {
  const session = sessions.get(sessionToken);
  if (session) evict(sessionToken, session);
}

export function closeAllDatabases(): void {
  for (const [token, session] of sessions) {
    evict(token, session);
  }
}

export function isDatabaseOpen(sessionToken: string): boolean {
  return sessions.has(sessionToken);
}

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (isExpired(session, now)) {
      evict(token, session);
    }
  }
}

let _cleanupTimer: ReturnType<typeof setInterval> | null = null;
export function startSessionCleanup(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);
  if (typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    (_cleanupTimer as NodeJS.Timeout).unref();
  }
}

// ============================================================
// Test-only helpers.
//
// Exported with a `__forTesting` namespace so production code never
// reaches for them accidentally (grep-friendly).  The injected stub
// keeps the public surface (`getDatabase`, `getSessionUserId`,
// `closeDatabase`, …) testable without opening a real libsql client.
// ============================================================
const STUB_DB_SENTINEL = Symbol('SU-ITER-089 · P1-6 stub db');

export const __forTesting = guardTestingHooks('db/connection', {
  /**
   * Inject a stub session at a fixed creation time.  If `clientClose`
   * is provided the fake client's `.close()` call forwards to it so
   * tests can assert eviction paths actually release handles.
   */
  injectSession(
    token: string,
    opts: {
      userId: string;
      createdAt?: number;
      lastAccessAt?: number;
      clientClose?: () => void;
      /**
       * SU-ITER-089 · P1-1 · B8-7 — optional DEK buffer so tests can
       * assert `evict()` zeroises it.  Kept optional for backwards
       * compatibility with TTL tests that do not care about the key.
       */
      encryptionKey?: Buffer | null;
    },
  ): void {
    const now = Date.now();
    sessions.set(token, {
      client: { close: opts.clientClose ?? (() => {}) },
      db: { [STUB_DB_SENTINEL]: true } as unknown as LibSQLDatabase<typeof schema>,
      userId: opts.userId,
      createdAt: opts.createdAt ?? now,
      lastAccessAt: opts.lastAccessAt ?? now,
      encryptionKey: opts.encryptionKey ?? null,
    });
  },

  /** Force `lastAccessAt = Date.now()` without going through `getDatabase`. */
  touch(token: string): void {
    const s = sessions.get(token);
    if (s) s.lastAccessAt = Date.now();
  },

  /** Peek at session metadata for assertions. */
  peek(token: string): { createdAt: number; lastAccessAt: number } | null {
    const s = sessions.get(token);
    return s ? { createdAt: s.createdAt, lastAccessAt: s.lastAccessAt } : null;
  },

  /** Run the periodic cleanup synchronously. */
  runCleanup(): void {
    cleanupExpiredSessions();
  },

  /**
   * SU-ITER-089 · P1-1 · B8-10 — reset the cached data directory
   * so tests that swap `SOUL_UPLOAD_DATA_DIR` mid-process can force
   * a re-resolution on the next `getDataDir()` call.  Production
   * code never needs this; keep it on the testing namespace.
   */
  resetDataDirCache(): void {
    _dataDir = null;
  },
});
