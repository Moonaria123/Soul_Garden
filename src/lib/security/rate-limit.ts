// SU-ITER-090a · R10 — lightweight in-process sliding-window rate limiter.
//
// Used by `/api/db/accounts/get` username lookup to slow down
// enumeration attempts from the loopback interface.  The limiter is
// deliberately scoped to the current Node process: the app is a local
// desktop companion, only one server runs at a time, and we don't want
// to ship a Redis dependency for a self-hosted binary.
//
// Characteristics
// ---------------
//  • Sliding-window count per composite key (e.g. IP + username).
//  • LRU eviction — capped at `maxKeys` distinct keys to bound memory.
//  • Monotonic clock via `Date.now()` (injectable for tests).
//
// The limiter is per-endpoint: instantiate `createRateLimiter(...)` once
// at module scope so multiple requests share the same window store.

export interface RateLimitOptions {
  /** Max allowed requests inside the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** LRU cap on distinct keys tracked simultaneously. Default 1024. */
  maxKeys?: number;
  /** Injectable clock — only used by tests. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Number of remaining tokens in the current window. */
  remaining: number;
  /** Milliseconds until the oldest timestamp rolls out of the window. */
  resetMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Test hook — drops every tracked key. */
  reset(): void;
  /** Test hook — current distinct-key count. */
  size(): number;
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const { max, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 1024;
  const now = opts.now ?? Date.now;

  // Map preserves insertion order; we use that for LRU eviction by
  // re-inserting on every touch.
  const store = new Map<string, number[]>();

  function prune(timestamps: number[], cutoff: number): number[] {
    // Timestamps are always pushed in order, so we can drop from the
    // front until we hit the first in-window entry.
    let i = 0;
    while (i < timestamps.length && timestamps[i] <= cutoff) i += 1;
    return i === 0 ? timestamps : timestamps.slice(i);
  }

  function touch(key: string, entry: number[]): void {
    // Re-insert to mark as most-recently-used.
    store.delete(key);
    store.set(key, entry);
  }

  function evictIfNeeded(): void {
    while (store.size > maxKeys) {
      const firstKey = store.keys().next().value;
      if (firstKey === undefined) break;
      store.delete(firstKey);
    }
  }

  return {
    check(key: string): RateLimitResult {
      const t = now();
      const cutoff = t - windowMs;
      const prev = store.get(key) ?? [];
      const windowed = prune(prev, cutoff);

      if (windowed.length >= max) {
        touch(key, windowed);
        return {
          allowed: false,
          remaining: 0,
          resetMs: Math.max(0, (windowed[0] ?? t) + windowMs - t),
        };
      }

      windowed.push(t);
      touch(key, windowed);
      evictIfNeeded();
      return {
        allowed: true,
        remaining: max - windowed.length,
        resetMs: windowMs,
      };
    },
    reset() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}
