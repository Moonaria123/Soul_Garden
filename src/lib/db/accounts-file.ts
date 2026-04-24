import { getDataDir } from './connection';
import { hiddenRequire as _require } from '../utils/hidden-require';

// ============================================================
// Account File Handler (server-side)
// Stores account credentials (hashes, salts) in a JSON file.
// Must be unencrypted: login verification runs BEFORE the
// database encryption key is available.
// Node builtins resolved via `hiddenRequire` — see
// src/lib/utils/hidden-require.ts for the NFT rationale.
//
// SU-ITER-090b · P2-15 (degraded-to-P3) — async write chain.
// Rationale for the degrade (context: single-user deployment):
//   1. Every read/modify/write cycle in this module currently uses
//      *synchronous* fs APIs (readFileSync / writeFileSync).
//      Node's single-threaded event loop guarantees two sync calls
//      on the same tick never interleave, so two concurrent route
//      handlers that each call `putAccount(...)` end up strictly
//      serialised even without a mutex.
//   2. The file is only ever touched by the local Next.js server
//      process; there is no cross-process contention.
//   3. The writer already rotates through a `${path}.tmp` + rename
//      so a mid-write crash can't leave a torn accounts.json.
// Therefore the *correctness* bar is already met by the existing
// sync I/O.  What remained was a defensive scaffold: a per-process
// promise chain that serialises *async* writers (e.g. a future
// migration to `fs.promises.*` or a long-running rekey flow that
// yields between read and write).  `enqueueAccountsWrite` is that
// scaffold — see `putAccountAsync` / `registerFailedAttemptAsync`
// below.  Sync helpers stay unchanged; callers that care about
// ordering across `await` boundaries opt into the async path.
// ============================================================

export interface StoredAccount {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  email?: string;
  failedAttempts: number;
  lockUntil: string | null;
  createdAt: string;
}

function getAccountsFilePath(): string {
  const path = _require('path') as typeof import('path');
  return path.resolve(getDataDir(), 'accounts.json');
}

function readAccountsFile(): StoredAccount[] {
  const fs = _require('fs') as typeof import('fs');
  const filePath = getAccountsFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as StoredAccount[];
  } catch {
    return [];
  }
}

function writeAccountsFile(accounts: StoredAccount[]): void {
  const fs = _require('fs') as typeof import('fs');
  const filePath = getAccountsFilePath();
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(accounts, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function getAllAccounts(): StoredAccount[] {
  return readAccountsFile();
}

export function getAccountById(id: string): StoredAccount | undefined {
  return readAccountsFile().find((a) => a.id === id);
}

export function getAccountByUsername(username: string): StoredAccount | undefined {
  return readAccountsFile().find((a) => a.username === username);
}

export function putAccount(account: StoredAccount): void {
  const accounts = readAccountsFile();
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  writeAccountsFile(accounts);
}

export function deleteAccount(id: string): void {
  const accounts = readAccountsFile().filter((a) => a.id !== id);
  writeAccountsFile(accounts);
}

// ============================================================
// SU-088 · P0-A (option C): single-user-mode guard.
// Returns true when `putAccount` for this id is allowed.
// Allowed cases:
//   - No account exists yet (first registration).
//   - The id matches an already-stored account (updates).
// Rejected case:
//   - A different account already exists (second registration attempt).
// ============================================================
export function canCreateOrUpdateAccount(id: string): boolean {
  const all = readAccountsFile();
  if (all.length === 0) return true;
  return all.some((a) => a.id === id);
}

/** For tests only — bypasses filesystem and runs the guard purely. */
export function canCreateOrUpdateAccountFrom(
  existing: ReadonlyArray<Pick<StoredAccount, 'id'>>,
  id: string,
): boolean {
  if (existing.length === 0) return true;
  return existing.some((a) => a.id === id);
}

// ============================================================
// SU-ITER-090b · P2-15 (degraded-to-P3) — async serialisation.
//
// `_writeChain` is a process-local promise tail.  Each call to
// `enqueueAccountsWrite` appends a new task that runs strictly
// after every previously-enqueued task settles.  We `.catch()` the
// chain's own copy so a throwing task cannot break the chain for
// subsequent callers while still surfacing the error to the caller
// that issued it (via the awaited `task` promise).
//
// The helper is intentionally generic (`<T>`) so future writers
// — e.g. an async rekey that reads accounts, mutates, and writes
// back — can opt in without reaching into internals.
// ============================================================
let _writeChain: Promise<void> = Promise.resolve();

export function enqueueAccountsWrite<T>(task: () => T | Promise<T>): Promise<T> {
  const run = _writeChain.then(() => task());
  // Swallow errors on the shared tail so it can't poison subsequent
  // writers; the error still propagates to the awaiter via `run`.
  _writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Async variant of {@link putAccount} that guarantees FIFO ordering
 * against other enqueued writers.  Callers that stay fully synchronous
 * can keep using {@link putAccount}; `await`-crossing workflows should
 * prefer this helper so a slow writer cannot be overtaken.
 */
export async function putAccountAsync(account: StoredAccount): Promise<void> {
  await enqueueAccountsWrite(() => {
    putAccount(account);
  });
}

/**
 * Increment a user's `failedAttempts` counter, optionally setting a
 * lockout deadline.  Read-modify-write is serialised through the
 * same chain as {@link putAccountAsync} so a flurry of concurrent
 * failed logins cannot clobber each other's increments.  No-ops if
 * the account id is unknown.
 */
export async function registerFailedAttemptAsync(opts: {
  id: string;
  /** Optional ISO timestamp; pass `null` to clear an existing lock. */
  lockUntil?: string | null;
}): Promise<StoredAccount | undefined> {
  return enqueueAccountsWrite(() => {
    const accounts = readAccountsFile();
    const idx = accounts.findIndex((a) => a.id === opts.id);
    if (idx < 0) return undefined;
    const next: StoredAccount = {
      ...accounts[idx],
      failedAttempts: (accounts[idx].failedAttempts ?? 0) + 1,
      lockUntil: opts.lockUntil === undefined ? accounts[idx].lockUntil : opts.lockUntil,
    };
    accounts[idx] = next;
    writeAccountsFile(accounts);
    return next;
  });
}

/** Test-only — waits for the current write chain to drain. */
export function __drainAccountsWriteChainForTesting(): Promise<void> {
  return _writeChain.then(() => undefined);
}
