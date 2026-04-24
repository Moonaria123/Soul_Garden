import { describe, it, expect } from 'vitest';
import { AtomicEntityRestorePayloadSchema } from './restore-atomic';

// ============================================================
// SU-ITER-091-batch1 · sec-C-C — Zod validator tests for
// `memory/restore-entity-atomic`.  These pin the three failure
// modes the server used to let through before the schema existed:
//   1. missing / mis-typed fields that would later crash the tx
//   2. smuggled top-level keys
//   3. unbounded arrays
// ============================================================

function makeValid() {
  return {
    entity: { id: 'e1', name: 'Alice', entityType: 'soul' },
    chat: {
      sessions: [{ id: 's1' }],
      messages: [{ id: 'm1' }],
    },
    memory: {
      events: [{ id: 'ev1' }],
      facts: [],
      summaries: [],
      relationshipSnapshots: [{ id: 'rs1' }],
      openLoops: [],
    },
  };
}

describe('AtomicEntityRestorePayloadSchema', () => {
  it('accepts a minimally-valid payload', () => {
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(makeValid());
    expect(parsed.success).toBe(true);
  });

  it('accepts extra row columns via passthrough', () => {
    const p = makeValid();
    // Drizzle row objects carry many more fields than `.id`; the
    // schema must let those through so live backups continue to
    // import across a column addition without a schema redeploy.
    p.chat.sessions[0] = {
      id: 's1',
      entityId: 'e1',
      title: 'hi',
      createdAt: '2026-04-19',
    } as any;
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(true);
  });

  it('rejects missing entity.name', () => {
    const p = makeValid();
    delete (p.entity as any).name;
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects empty entity.id', () => {
    const p = makeValid();
    p.entity.id = '';
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects row objects without id', () => {
    const p = makeValid();
    p.chat.sessions = [{ title: 'no-id' } as any];
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects smuggled top-level keys', () => {
    const p = makeValid() as Record<string, unknown>;
    p.injected = { bad: 'data' };
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects smuggled memory.* keys', () => {
    const p = makeValid();
    (p.memory as unknown as Record<string, unknown>).extraTable = [{ id: 'x' }];
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects chat.messages above the cap', () => {
    const p = makeValid();
    // Synthesise a shallow over-cap array — use `length` so we don't
    // actually materialise a million objects in the test harness.
    const huge: { id: string }[] = [];
    huge.length = 1_000_001;
    huge.fill({ id: 'm' });
    p.chat.messages = huge;
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects non-array chat.sessions', () => {
    const p = makeValid();
    (p.chat as any).sessions = { id: 's1' };
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(p);
    expect(parsed.success).toBe(false);
  });

  it('rejects null payload', () => {
    const parsed = AtomicEntityRestorePayloadSchema.safeParse(null);
    expect(parsed.success).toBe(false);
  });
});
