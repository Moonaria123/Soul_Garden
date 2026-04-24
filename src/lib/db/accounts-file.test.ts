// SU-ITER-090b · P2-15 — accounts-file async write chain tests.
//
// Exercises the opt-in async serialisation path (`putAccountAsync`,
// `registerFailedAttemptAsync`, `enqueueAccountsWrite`) to prove:
//   1. Two concurrent `registerFailedAttemptAsync` calls never drop
//      an increment — the final `failedAttempts` equals the number
//      of calls, not 1.
//   2. A throwing enqueued task does not poison the chain for
//      subsequent writers.
//   3. Tasks observe FIFO ordering (test by awaiting each in turn).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  putAccount,
  putAccountAsync,
  registerFailedAttemptAsync,
  enqueueAccountsWrite,
  getAccountById,
  __drainAccountsWriteChainForTesting,
  type StoredAccount,
} from './accounts-file';
import { __forTesting as connForTesting } from './connection';

let tmpDir: string | null = null;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-accts-mutex-'));
  prevEnv = process.env.SOUL_UPLOAD_DATA_DIR;
  process.env.SOUL_UPLOAD_DATA_DIR = tmpDir;
  // `getDataDir()` caches; nudge the cache via the dedicated testing
  // reset hook exposed by connection.ts.
  connForTesting.resetDataDirCache();
});

afterEach(async () => {
  await __drainAccountsWriteChainForTesting();
  if (prevEnv === undefined) {
    delete process.env.SOUL_UPLOAD_DATA_DIR;
  } else {
    process.env.SOUL_UPLOAD_DATA_DIR = prevEnv;
  }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    tmpDir = null;
  }
});

const sample: StoredAccount = {
  id: 'user-1',
  username: 'alice',
  passwordHash: 'hash',
  salt: 'abcd',
  failedAttempts: 0,
  lockUntil: null,
  createdAt: '2026-04-19T00:00:00Z',
};

describe('accounts-file async write chain (SU-ITER-090b · P2-15)', () => {
  it('registerFailedAttemptAsync is safe under concurrent callers', async () => {
    putAccount(sample);

    // Kick off N concurrent failed-attempt increments.  A naive
    // read-modify-write without the chain would race on the shared
    // read-then-write and leave failedAttempts at 1 instead of N.
    const N = 8;
    const promises = Array.from({ length: N }, () =>
      registerFailedAttemptAsync({ id: 'user-1' }),
    );
    const results = await Promise.all(promises);

    // Every task should have seen a monotonically increasing count.
    const counts = results.map((r) => r?.failedAttempts ?? -1).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // And the final on-disk state matches the last write.
    const final = getAccountById('user-1');
    expect(final?.failedAttempts).toBe(N);
  });

  it('noops when the account id does not exist', async () => {
    const result = await registerFailedAttemptAsync({ id: 'ghost' });
    expect(result).toBeUndefined();
  });

  it('does not poison the chain when a task throws', async () => {
    putAccount(sample);

    // Intentionally-throwing task in the middle of the queue.
    const first = putAccountAsync({ ...sample, failedAttempts: 1 });
    const failing = enqueueAccountsWrite<string>(() => {
      throw new Error('deliberate test failure');
    });
    const third = putAccountAsync({ ...sample, failedAttempts: 3 });

    await first;
    await expect(failing).rejects.toThrow('deliberate test failure');
    await third;

    const after = getAccountById('user-1');
    expect(after?.failedAttempts).toBe(3);
  });

  it('preserves FIFO ordering across writers', async () => {
    putAccount(sample);
    const observed: number[] = [];

    const p1 = enqueueAccountsWrite(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(1);
    });
    const p2 = enqueueAccountsWrite(() => { observed.push(2); });
    const p3 = enqueueAccountsWrite(() => { observed.push(3); });

    await Promise.all([p1, p2, p3]);
    expect(observed).toEqual([1, 2, 3]);
  });
});
