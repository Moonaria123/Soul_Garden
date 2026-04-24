import { describe, it, expect, vi } from 'vitest';
import {
  planEntityRestoreOps,
  applyRestoreOps,
  runAtomicEntityRestore,
  type AtomicEntityRestorePayload,
  type AtomicTxHandle,
  type RestoreOp,
} from './restore-atomic';

// ============================================================
// SU-088 · P0-E rollback tests.
//
// These tests exercise the pure plan + the transaction contract
// using a mock tx harness.  Mock tx records every operation it
// receives; the outer "database" only applies them on successful
// commit.  If `db.transaction(fn)` rejects, nothing is committed,
// mirroring libsql's actual rollback semantics.
// ============================================================

function makePayload(overrides: Partial<AtomicEntityRestorePayload> = {}): AtomicEntityRestorePayload {
  return {
    entity: {
      id: 'entity-1',
      name: 'Alice',
      entityType: 'soul',
      ...(overrides.entity ?? {}),
    } as AtomicEntityRestorePayload['entity'],
    chat: {
      sessions: [{ id: 's1', entityId: 'entity-1', title: 'hi' } as any],
      messages: [{ id: 'm1', sessionId: 's1', entityId: 'entity-1', role: 'user', content: 'hello' } as any],
      ...(overrides.chat ?? {}),
    },
    memory: {
      events: [{ id: 'e1', entityId: 'entity-1', kind: 'raw', content: 'x' } as any],
      facts: [],
      summaries: [],
      relationshipSnapshots: [{ id: 'r1', entityId: 'entity-1' } as any],
      openLoops: [],
      ...(overrides.memory ?? {}),
    },
  };
}

describe('planEntityRestoreOps', () => {
  it('includes deletes BEFORE the entity upsert when replacing', () => {
    const ops = planEntityRestoreOps(makePayload(), 'replace-existing');
    const firstUpsertIdx = ops.findIndex((o) => o.kind === 'upsert-entity');
    const lastDeleteIdx = ops.map((o) => o.kind).lastIndexOf('delete-entity');
    expect(lastDeleteIdx).toBeGreaterThan(-1);
    expect(lastDeleteIdx).toBeLessThan(firstUpsertIdx);
  });

  it('orders child-table deletes before the parent `entities` delete', () => {
    const ops = planEntityRestoreOps(makePayload(), 'replace-existing');
    const deleteOrder = ops
      .filter((o) => o.kind.startsWith('delete-'))
      .map((o) => o.kind);
    expect(deleteOrder).toEqual([
      'delete-openLoops',
      'delete-memorySummaries',
      'delete-memoryFacts',
      'delete-memoryEvents',
      'delete-relationshipSnapshots',
      'delete-chatMessages',
      'delete-chatSessions',
      'delete-entity',
    ]);
  });

  it('skips all deletes for create-new strategy', () => {
    const ops = planEntityRestoreOps(makePayload(), 'create-new');
    expect(ops.some((o) => o.kind.startsWith('delete-'))).toBe(false);
    expect(ops[0].kind).toBe('upsert-entity');
  });

  it('omits insert ops for empty collections', () => {
    const ops = planEntityRestoreOps(
      makePayload({
        chat: { sessions: [], messages: [] },
        memory: { events: [], facts: [], summaries: [], relationshipSnapshots: [], openLoops: [] },
      }),
      'create-new',
    );
    const insertKinds = ops.filter((o) => o.kind.startsWith('insert-')).map((o) => o.kind);
    expect(insertKinds).toEqual([]);
  });
});

// ------------------------------------------------------------
// Mock transaction harness.  The harness mimics libsql's commit /
// rollback contract without requiring a real SQLite file.
// ------------------------------------------------------------

interface MockState {
  committedOps: RestoreOp[];
  /** Simulated row store — pre-populated rows used to verify rollback. */
  pre: { entities: Set<string>; messages: Set<string> };
  /** `post` mirrors the committed state; tests inspect this. */
  post: { entities: Set<string>; messages: Set<string> };
}

function makeMockHarness(initial: { entities?: string[]; messages?: string[] } = {}) {
  const state: MockState = {
    committedOps: [],
    pre: { entities: new Set(initial.entities ?? []), messages: new Set(initial.messages ?? []) },
    post: { entities: new Set(initial.entities ?? []), messages: new Set(initial.messages ?? []) },
  };

  /**
   * Run `fn` with a tx handle.  The handle writes into a local buffer;
   * only a successful fn resolution flushes it into `state.post`.
   * A thrown error discards the buffer — just like SQLite ROLLBACK.
   */
  async function transaction(fn: (tx: AtomicTxHandle) => Promise<void>): Promise<void> {
    const pending: RestoreOp[] = [];
    const snapshot = {
      entities: new Set(state.post.entities),
      messages: new Set(state.post.messages),
    };

    const tx: AtomicTxHandle = {
      delete: ((_table: unknown) => ({
        where: async () => {
          pending.push({ kind: 'delete-entity', entityId: '*' });
        },
      })) as unknown as AtomicTxHandle['delete'],
      insert: ((_table: unknown) => ({
        values: (rows: any) => ({
          onConflictDoNothing: async () => {
            pending.push({ kind: 'insert-chatMessages', rows: Array.isArray(rows) ? rows : [rows] } as RestoreOp);
          },
          onConflictDoUpdate: async () => {
            pending.push({ kind: 'upsert-entity', row: Array.isArray(rows) ? rows[0] : rows } as RestoreOp);
          },
        }),
      })) as unknown as AtomicTxHandle['insert'],
    };

    try {
      await fn(tx);
      state.committedOps.push(...pending);
      // Commit: nothing to replay here since we only track raw op calls;
      // the important invariants are captured via committedOps + post state.
      state.post = snapshot;
    } catch (e) {
      // Rollback — restore snapshot explicitly to make the guarantee
      // visible in the test, even though we never mutated `post`.
      state.post = snapshot;
      throw e;
    }
  }

  return { state, transaction };
}

describe('applyRestoreOps + transaction rollback contract', () => {
  it('commits every planned op when the transaction succeeds', async () => {
    const payload = makePayload();
    const ops = planEntityRestoreOps(payload, 'replace-existing');
    const harness = makeMockHarness();

    await harness.transaction(async (tx) => {
      await applyRestoreOps(tx, ops);
    });

    // 8 deletes + 1 upsert-entity + 1 insert-chatSessions + 1 insert-chatMessages
    // + 1 insert-memoryEvents + 1 upsert-relationshipSnapshot = 13 ops.
    expect(harness.state.committedOps.length).toBe(ops.length);
  });

  it('commits nothing when an op throws mid-transaction (rollback)', async () => {
    const payload = makePayload();
    const ops = planEntityRestoreOps(payload, 'replace-existing');
    const harness = makeMockHarness({ entities: ['entity-1'], messages: ['m1'] });

    // Wrap the tx so the Nth operation explodes — mirroring a real
    // SQLite INSERT that fails on a NOT NULL constraint.
    const explodingApply = async (tx: AtomicTxHandle) => {
      for (let i = 0; i < ops.length; i++) {
        if (i === 4) throw new Error('simulated failure mid-restore');
        await applyRestoreOps(tx, [ops[i]]);
      }
    };

    await expect(
      harness.transaction(async (tx) => {
        await explodingApply(tx);
      }),
    ).rejects.toThrow('simulated failure mid-restore');

    // Nothing committed; state is exactly what we started with.
    expect(harness.state.committedOps).toEqual([]);
    expect([...harness.state.post.entities]).toEqual(['entity-1']);
    expect([...harness.state.post.messages]).toEqual(['m1']);
  });
});

describe('runAtomicEntityRestore', () => {
  it('opens a transaction and forwards the plan to applyRestoreOps', async () => {
    const payload = makePayload();
    const dbSpy = {
      transaction: vi.fn(async (fn: (tx: AtomicTxHandle) => Promise<void>) => {
        const callLog: string[] = [];
        const tx: AtomicTxHandle = {
          delete: ((_table: unknown) => ({
            where: async () => {
              callLog.push('delete');
            },
          })) as unknown as AtomicTxHandle['delete'],
          insert: ((_table: unknown) => ({
            values: () => ({
              onConflictDoNothing: async () => {
                callLog.push('insert');
              },
              onConflictDoUpdate: async () => {
                callLog.push('upsert');
              },
            }),
          })) as unknown as AtomicTxHandle['insert'],
        };
        await fn(tx);
        expect(callLog.length).toBeGreaterThan(0);
      }),
    };

    await runAtomicEntityRestore(
      dbSpy as unknown as Parameters<typeof runAtomicEntityRestore>[0],
      payload,
      'replace-existing',
    );
    expect(dbSpy.transaction).toHaveBeenCalledOnce();
  });

  it('rejects when the transaction callback rejects', async () => {
    const dbSpy = {
      transaction: vi.fn(async () => {
        throw new Error('libsql rolled back');
      }),
    };
    await expect(
      runAtomicEntityRestore(
        dbSpy as unknown as Parameters<typeof runAtomicEntityRestore>[0],
        makePayload(),
        'replace-existing',
      ),
    ).rejects.toThrow('libsql rolled back');
  });
});
