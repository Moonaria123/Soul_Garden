import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import {
  getDatabase,
  getSessionUserId,
  isDatabaseOpen,
  closeDatabase,
  closeAllDatabases,
  IDLE_TTL_MS,
  ABSOLUTE_TTL_MS,
  libsqlLocalFileUrl,
  __forTesting,
} from './connection';

// ============================================================
// SU-ITER-089 · P1-6 · server-side session TTL tests.
//
// The session map lives behind `connection.ts`.  We exercise the
// sliding-idle + absolute-hard-cap invariants without touching libsql
// at all: the test harness injects pre-made session entries via
// `__forTesting.injectSession` and drives the clock with
// `vi.useFakeTimers()`.
//
// Invariants under test:
//   A. `IDLE_TTL_MS < ABSOLUTE_TTL_MS` — idle cap must be the tighter
//      floor so the absolute cap only fires on long-lived but active
//      sessions.
//   B. `getDatabase` / `getSessionUserId` touch `lastAccessAt` on hit,
//      extending the idle window.
//   C. `getDatabase` / `getSessionUserId` evict + return `null` when
//      either TTL is breached on access, without waiting for the
//      periodic cleanup timer.
//   D. `cleanupExpiredSessions` evicts both idle- and absolute-expired
//      entries in a single pass.
//   E. `closeDatabase` / `closeAllDatabases` remove entries regardless
//      of TTL state.
// ============================================================

beforeEach(() => {
  closeAllDatabases();
  vi.useFakeTimers();
});

afterEach(() => {
  closeAllDatabases();
  vi.useRealTimers();
});

describe('libsqlLocalFileUrl', () => {
  it('returns a file URL with forward slashes only (libsql on Windows requires valid file: URLs)', () => {
    const abs = path.resolve(process.cwd(), '.soul-upload-data', 'soul-upload.db');
    const url = libsqlLocalFileUrl(abs);
    expect(url.startsWith('file:')).toBe(true);
    expect(url).not.toContain('\\');
  });
});

describe('TTL constants (invariant A)', () => {
  it('idle TTL is strictly less than absolute TTL', () => {
    expect(IDLE_TTL_MS).toBeGreaterThan(0);
    expect(ABSOLUTE_TTL_MS).toBeGreaterThan(0);
    expect(IDLE_TTL_MS).toBeLessThan(ABSOLUTE_TTL_MS);
  });
});

describe('sliding idle refresh (invariant B)', () => {
  it('getDatabase touches lastAccessAt on hit', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });
    expect(__forTesting.peek('tok')?.lastAccessAt).toBe(t0);

    vi.setSystemTime(t0 + 60_000);
    expect(getDatabase('tok')).not.toBeNull();
    expect(__forTesting.peek('tok')?.lastAccessAt).toBe(t0 + 60_000);
  });

  it('getSessionUserId touches lastAccessAt on hit', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });

    vi.setSystemTime(t0 + 5 * 60_000);
    expect(getSessionUserId('tok')).toBe('u1');
    expect(__forTesting.peek('tok')?.lastAccessAt).toBe(t0 + 5 * 60_000);
  });

  it('activity within idle window keeps session alive indefinitely (up to absolute cap)', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });

    // Poke the session every (idle - 1s) for just under the absolute cap.
    const tick = IDLE_TTL_MS - 1_000;
    const ticks = Math.floor((ABSOLUTE_TTL_MS - 1_000) / tick);
    let now = t0;
    for (let i = 0; i < ticks; i++) {
      now += tick;
      vi.setSystemTime(now);
      expect(getDatabase('tok')).not.toBeNull();
    }
    // createdAt never moves.
    expect(__forTesting.peek('tok')?.createdAt).toBe(t0);
  });
});

describe('idle timeout (invariant C.1)', () => {
  it('returns null and evicts when idle window exceeded on getDatabase', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });

    vi.setSystemTime(t0 + IDLE_TTL_MS + 1);
    expect(getDatabase('tok')).toBeNull();
    expect(isDatabaseOpen('tok')).toBe(false);
  });

  it('returns null and evicts when idle window exceeded on getSessionUserId', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });

    vi.setSystemTime(t0 + IDLE_TTL_MS + 1);
    expect(getSessionUserId('tok')).toBeNull();
    expect(isDatabaseOpen('tok')).toBe(false);
  });

  it('closes the libsql client on idle eviction', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    const close = vi.fn();
    __forTesting.injectSession('tok', { userId: 'u1', clientClose: close });

    vi.setSystemTime(t0 + IDLE_TTL_MS + 1);
    expect(getDatabase('tok')).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('absolute timeout (invariant C.2)', () => {
  it('returns null even when session has been continuously active', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });

    // Simulate continuous activity right up to the absolute cap — the
    // idle TTL is refreshed each call so only the absolute cap fires.
    let now = t0;
    const tick = IDLE_TTL_MS - 1_000;
    while (now + tick <= t0 + ABSOLUTE_TTL_MS) {
      now += tick;
      vi.setSystemTime(now);
      expect(getDatabase('tok')).not.toBeNull();
    }

    vi.setSystemTime(t0 + ABSOLUTE_TTL_MS + 1);
    expect(getDatabase('tok')).toBeNull();
    expect(isDatabaseOpen('tok')).toBe(false);
  });

  it('fires even if caller only uses getSessionUserId', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('tok', { userId: 'u1' });

    vi.setSystemTime(t0 + ABSOLUTE_TTL_MS + 1);
    expect(getSessionUserId('tok')).toBeNull();
  });
});

describe('cleanupExpiredSessions (invariant D)', () => {
  it('evicts both idle- and absolute-expired entries in one pass', () => {
    const t0 = 1_000_000_000_000;
    // `idle-dead` and `abs-dead` both created at t0; `alive` created
    // just before the check so neither TTL can touch it.
    vi.setSystemTime(t0);
    __forTesting.injectSession('idle-dead', { userId: 'a' });
    __forTesting.injectSession('abs-dead', { userId: 'b' });

    // Simulate `abs-dead` being continuously active by refreshing
    // `lastAccessAt` right up to the absolute cap — idle TTL stays
    // fresh but `createdAt` is still t0.
    const refreshTick = IDLE_TTL_MS - 60_000;
    let now = t0;
    while (now < t0 + ABSOLUTE_TTL_MS - refreshTick) {
      now += refreshTick;
      vi.setSystemTime(now);
      __forTesting.touch('abs-dead');
    }

    // Move past t0 + ABSOLUTE so `abs-dead` fails the absolute cap and
    // `idle-dead` (never refreshed) fails the idle cap; drop `alive` in
    // at this moment so both TTLs are wide open for it.
    vi.setSystemTime(t0 + ABSOLUTE_TTL_MS + 2);
    __forTesting.injectSession('alive', { userId: 'c' });

    __forTesting.runCleanup();

    expect(isDatabaseOpen('idle-dead')).toBe(false);
    expect(isDatabaseOpen('abs-dead')).toBe(false);
    expect(isDatabaseOpen('alive')).toBe(true);
  });

  it('closes client handles on cleanup eviction', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    const close = vi.fn();
    __forTesting.injectSession('tok', { userId: 'u1', clientClose: close });

    vi.setSystemTime(t0 + IDLE_TTL_MS + 1);
    __forTesting.runCleanup();

    expect(close).toHaveBeenCalledTimes(1);
    expect(isDatabaseOpen('tok')).toBe(false);
  });
});

describe('explicit close (invariant E)', () => {
  it('closeDatabase removes a live session without relying on TTL', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    const close = vi.fn();
    __forTesting.injectSession('tok', { userId: 'u1', clientClose: close });

    closeDatabase('tok');
    expect(close).toHaveBeenCalledTimes(1);
    expect(isDatabaseOpen('tok')).toBe(false);
  });

  it('closeAllDatabases clears every live session', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    __forTesting.injectSession('a', { userId: 'u1' });
    __forTesting.injectSession('b', { userId: 'u2' });

    closeAllDatabases();
    expect(isDatabaseOpen('a')).toBe(false);
    expect(isDatabaseOpen('b')).toBe(false);
  });
});

describe('missing session', () => {
  it('getDatabase on unknown token returns null without throwing', () => {
    expect(getDatabase('no-such-token')).toBeNull();
  });

  it('getSessionUserId on unknown token returns null', () => {
    expect(getSessionUserId('no-such-token')).toBeNull();
  });
});

// ============================================================
// SU-ITER-089 · P1-1 · B8-7/B8-10 — DEK buffer zeroisation on evict.
//
// The one reachable plaintext DEK replica outside libsql's Rust heap
// lives on `DbSession.encryptionKey` as a Node `Buffer`.  Every eviction
// path (explicit close, idle expiry, absolute cap, bulk close) must
// `.fill(0)` that buffer before dropping the session.  These tests
// inject a session with a real Buffer and assert every byte is zero
// after eviction.
// ============================================================
describe('encryptionKey zeroisation (invariant B8-7)', () => {
  function makeKey(): Buffer {
    // 32 deterministic non-zero bytes so a missed fill stands out.
    const b = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) b[i] = (i + 1) & 0xff;
    return b;
  }

  it('closeDatabase zeroes the key buffer', () => {
    const key = makeKey();
    __forTesting.injectSession('tok', { userId: 'u1', encryptionKey: key });
    closeDatabase('tok');
    // After evict, every byte should be 0.  The buffer identity is
    // preserved — evict mutates in place before nulling the field.
    expect(Array.from(key)).toEqual(Array(32).fill(0));
  });

  it('closeAllDatabases zeroes every live key buffer', () => {
    const k1 = makeKey();
    const k2 = makeKey();
    __forTesting.injectSession('a', { userId: 'u1', encryptionKey: k1 });
    __forTesting.injectSession('b', { userId: 'u2', encryptionKey: k2 });
    closeAllDatabases();
    expect(Array.from(k1)).toEqual(Array(32).fill(0));
    expect(Array.from(k2)).toEqual(Array(32).fill(0));
  });

  it('idle TTL eviction also zeroes the key', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    const key = makeKey();
    __forTesting.injectSession('tok', { userId: 'u1', encryptionKey: key });

    vi.setSystemTime(t0 + IDLE_TTL_MS + 1);
    expect(getDatabase('tok')).toBeNull(); // eager expiry path
    expect(Array.from(key)).toEqual(Array(32).fill(0));
  });

  it('absolute TTL eviction zeroes the key even if recently touched', () => {
    const t0 = 1_000_000_000_000;
    vi.setSystemTime(t0);
    const key = makeKey();
    __forTesting.injectSession('tok', {
      userId: 'u1',
      encryptionKey: key,
      createdAt: t0,
      lastAccessAt: t0,
    });

    // Refresh the idle window every step so only the absolute cap
    // can fire.  `touch()` is the test-only back door that bumps
    // lastAccessAt without going through getDatabase's expiry check.
    const step = Math.floor(IDLE_TTL_MS / 2);
    let now = t0;
    while (now + step < t0 + ABSOLUTE_TTL_MS) {
      now += step;
      vi.setSystemTime(now);
      __forTesting.touch('tok');
    }
    // Session is still alive just under the absolute cap.
    vi.setSystemTime(t0 + ABSOLUTE_TTL_MS - 1);
    __forTesting.touch('tok');
    expect(getDatabase('tok')).not.toBeNull();

    // Cross the absolute cap — idle is fresh, absolute should fire.
    vi.setSystemTime(t0 + ABSOLUTE_TTL_MS + 1);
    expect(getDatabase('tok')).toBeNull();
    expect(Array.from(key)).toEqual(Array(32).fill(0));
  });
});
