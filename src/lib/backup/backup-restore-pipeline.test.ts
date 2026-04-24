/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · backup coverage — `backup-restore.ts` had 43 %
 * coverage with the ZIP/crypto ingress already tested in
 * `backup-shape-guard.test.ts` and `backup-v1-restore-in-v2.test.ts`,
 * but the *restore pipeline* (`restoreChatPayload`,
 * `restoreEntityPayload`, `restoreConfigPayload`, `restoreFullPayload`,
 * and the `remapEntityIds` helper) ran without unit coverage.
 *
 * This file mocks `@/lib/db/db-client` and pins each restore function's
 * call pattern — strategies, batching, id-remapping — which are the
 * pieces that historically drifted when the schema evolved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ChatBackupPayload,
  EntityBackupPayload,
  ConfigBackupPayload,
  GlobalBackupPayload,
} from './backup-format';

vi.mock('@/lib/db/db-client', () => ({
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
  deleteMessagesForSession: vi.fn(),
  upsertSession: vi.fn(),
  insertMessages: vi.fn(),
  restoreEntityAtomic: vi.fn(),
  upsertProvider: vi.fn(),
  upsertModel: vi.fn(),
  upsertUserProfile: vi.fn(),
  setConfig: vi.fn(),
}));

const dbClient = await import('@/lib/db/db-client');
const {
  restoreChatPayload,
  restoreEntityPayload,
  restoreConfigPayload,
  restoreFullPayload,
} = await import('./backup-restore');

function makeChatPayload(overrides?: Partial<ChatBackupPayload>): ChatBackupPayload {
  return {
    sessions: [
      {
        id: 's1',
        entityId: 'e1',
        title: 't',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    messages: [
      {
        id: 'm1',
        sessionId: 's1',
        entityId: 'e1',
        role: 'user',
        content: 'hi',
        createdAt: new Date(),
      },
    ],
    ...overrides,
  } as unknown as ChatBackupPayload;
}

function makeEntityPayload(entityId = 'e1'): EntityBackupPayload {
  return {
    entity: {
      id: entityId,
      name: 'E',
      entityType: 'fictional',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    chat: {
      sessions: [
        {
          id: 's1',
          entityId,
          title: 't',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          entityId,
          role: 'user',
          content: 'hi',
          createdAt: new Date(),
        },
      ],
    },
    memory: {
      events: [
        { id: 'ev1', entityId, sessionId: 's1' } as EntityBackupPayload['memory']['events'][number],
      ],
      facts: [
        { id: 'f1', entityId } as EntityBackupPayload['memory']['facts'][number],
      ],
      summaries: [
        { id: 'sum1', entityId } as EntityBackupPayload['memory']['summaries'][number],
      ],
      relationshipSnapshots: [
        { id: 'rs1', entityId } as EntityBackupPayload['memory']['relationshipSnapshots'][number],
      ],
      openLoops: [
        { id: 'l1', entityId, originEventId: 'ev1' } as EntityBackupPayload['memory']['openLoops'][number],
      ],
    },
  } as unknown as EntityBackupPayload;
}

describe('restoreChatPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('overwrite strategy deletes existing sessions before upsert', async () => {
    vi.mocked(dbClient.listSessions).mockResolvedValue([
      { id: 'old1', entityId: 'e1' },
    ] as unknown as Awaited<ReturnType<typeof dbClient.listSessions>>);

    await restoreChatPayload('e1', makeChatPayload(), 'overwrite');

    expect(dbClient.listSessions).toHaveBeenCalledWith('e1');
    expect(dbClient.deleteMessagesForSession).toHaveBeenCalledWith('old1');
    expect(dbClient.deleteSession).toHaveBeenCalledWith('old1');
    expect(dbClient.upsertSession).toHaveBeenCalled();
    expect(dbClient.insertMessages).toHaveBeenCalledTimes(1);
  });

  it('merge strategy skips deletes', async () => {
    await restoreChatPayload('e1', makeChatPayload(), 'merge');
    expect(dbClient.listSessions).not.toHaveBeenCalled();
    expect(dbClient.deleteSession).not.toHaveBeenCalled();
    expect(dbClient.upsertSession).toHaveBeenCalled();
  });

  it('batches large message inserts into 200-row chunks', async () => {
    const messages = Array.from({ length: 450 }, (_, i) => ({
      id: `m${i}`,
      sessionId: 's1',
      entityId: 'e1',
      role: 'user' as const,
      content: String(i),
      createdAt: new Date(),
    }));
    await restoreChatPayload(
      'e1',
      makeChatPayload({ messages } as unknown as Partial<ChatBackupPayload>),
      'merge',
    );
    // 450 / 200 → 3 batches (200, 200, 50).
    expect(dbClient.insertMessages).toHaveBeenCalledTimes(3);
  });
});

describe('restoreEntityPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it("'replace-existing' delegates to restoreEntityAtomic with the original id", async () => {
    const p = makeEntityPayload('original-id');
    const returnedId = await restoreEntityPayload(p, 'replace-existing');
    expect(returnedId).toBe('original-id');
    expect(dbClient.restoreEntityAtomic).toHaveBeenCalledTimes(1);
    const [rawData, strategy] = vi.mocked(dbClient.restoreEntityAtomic).mock.calls[0];
    const data = rawData as EntityBackupPayload;
    expect(data.entity.id).toBe('original-id');
    expect(strategy).toBe('replace-existing');
  });

  it("'create-new' remaps every row id + returns the fresh entity id", async () => {
    const p = makeEntityPayload('original-id');
    const returnedId = await restoreEntityPayload(p, 'create-new');
    expect(returnedId).not.toBe('original-id');
    expect(returnedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const [rawData] = vi.mocked(dbClient.restoreEntityAtomic).mock.calls[0];
    const data = rawData as EntityBackupPayload;
    // remapped entity id
    expect(data.entity.id).toBe(returnedId);
    // session + message get fresh ids and new entityId wired through
    expect(data.chat.sessions[0].id).not.toBe('s1');
    expect(data.chat.sessions[0].entityId).toBe(returnedId);
    expect(data.chat.messages[0].id).not.toBe('m1');
    expect(data.chat.messages[0].sessionId).toBe(data.chat.sessions[0].id);
    expect(data.chat.messages[0].entityId).toBe(returnedId);
    // event/fact/summary/snapshot/loop entityIds all rewritten
    expect(data.memory.events[0].entityId).toBe(returnedId);
    expect(data.memory.facts[0].entityId).toBe(returnedId);
    expect(data.memory.summaries[0].entityId).toBe(returnedId);
    expect(data.memory.relationshipSnapshots[0].entityId).toBe(returnedId);
    expect(data.memory.openLoops[0].entityId).toBe(returnedId);
    // openLoop.originEventId chases the event-id map
    expect(data.memory.openLoops[0].originEventId).toBe(data.memory.events[0].id);
  });
});

describe('restoreConfigPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts providers, models, profile + writes known config keys', async () => {
    const cfg: ConfigBackupPayload = {
      providers: [{ id: 'p1' } as Parameters<typeof dbClient.upsertProvider>[0]],
      providerModels: [{ id: 'pm1' } as Parameters<typeof dbClient.upsertModel>[0]],
      userProfile: { id: 'u1' } as Parameters<typeof dbClient.upsertUserProfile>[0],
      appConfig: [
        { key: 'language', value: 'en' } as ConfigBackupPayload['appConfig'][number],
        { key: 'x', value: undefined } as unknown as ConfigBackupPayload['appConfig'][number],
      ],
    } as ConfigBackupPayload;

    await restoreConfigPayload(cfg);

    expect(dbClient.upsertProvider).toHaveBeenCalledTimes(1);
    expect(dbClient.upsertModel).toHaveBeenCalledTimes(1);
    expect(dbClient.upsertUserProfile).toHaveBeenCalledTimes(1);
    // only the row with a defined value becomes a setConfig call
    expect(dbClient.setConfig).toHaveBeenCalledTimes(1);
    expect(dbClient.setConfig).toHaveBeenCalledWith('language', 'en');
  });

  it('skips userProfile when null', async () => {
    await restoreConfigPayload({
      providers: [],
      providerModels: [],
      userProfile: null,
      appConfig: [],
    } as ConfigBackupPayload);
    expect(dbClient.upsertUserProfile).not.toHaveBeenCalled();
  });
});

describe('restoreFullPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes config + entity paths + fires progress for both', async () => {
    const gp: GlobalBackupPayload = {
      config: {
        providers: [],
        providerModels: [],
        userProfile: null,
        appConfig: [],
      },
      entities: [makeEntityPayload('e1'), makeEntityPayload('e2')],
    } as GlobalBackupPayload;

    const progress = vi.fn();
    await restoreFullPayload(gp, 'replace-existing', progress);

    expect(dbClient.restoreEntityAtomic).toHaveBeenCalledTimes(2);
    const phases = progress.mock.calls.map((c) => c[0]);
    expect(phases).toContain('restoring-config');
    expect(phases).toContain('restoring-entities');
  });

  it('gracefully handles payload with neither config nor entities', async () => {
    await expect(
      restoreFullPayload({} as GlobalBackupPayload, 'replace-existing'),
    ).resolves.toBeUndefined();
    expect(dbClient.restoreEntityAtomic).not.toHaveBeenCalled();
  });
});
