/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · backup coverage — `backup-serializer.ts`
 * previously sat at 0 % because no unit test exercised its
 * `dbClient.*` plumbing directly.  This file mocks `@/lib/db/db-client`
 * and pins the assembly contracts for all four serialize* helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ChatSessionRow,
  ChatMessageRow,
  EntityRow,
  ProviderRow,
  ProviderModelRow,
  UserProfileRow,
  AppConfigRow,
  MemoryEventRow,
  MemoryFactRow,
  MemorySummaryRow,
  RelationshipSnapshotRow,
  OpenLoopRow,
} from '@/lib/db/db-client';

vi.mock('@/lib/db/db-client', () => ({
  listSessions: vi.fn(),
  listMessages: vi.fn(),
  getEntity: vi.fn(),
  listMemoryEvents: vi.fn(),
  listMemoryFacts: vi.fn(),
  listMemorySummaries: vi.fn(),
  getRelationshipSnapshot: vi.fn(),
  listOpenLoops: vi.fn(),
  listProviders: vi.fn(),
  listModels: vi.fn(),
  getUserProfile: vi.fn(),
  getConfig: vi.fn(),
  listEntities: vi.fn(),
}));

const dbClient = await import('@/lib/db/db-client');
const {
  serializeChatPayload,
  serializeEntityPayload,
  serializeConfigPayload,
  serializeFullPayload,
  serializeAllEntitiesPayload,
} = await import('./backup-serializer');

function makeSession(id: string, entityId: string): ChatSessionRow {
  return {
    id,
    entityId,
    title: 'sess',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ChatSessionRow;
}

function makeMessage(id: string, sessionId: string, entityId: string): ChatMessageRow {
  return {
    id,
    sessionId,
    entityId,
    role: 'user',
    content: 'hi',
    createdAt: new Date(),
  } as unknown as ChatMessageRow;
}

function makeEntity(id: string): EntityRow {
  return {
    id,
    name: 'E',
    entityType: 'fictional',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as EntityRow;
}

describe('serializeChatPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates messages across all sessions for the entity', async () => {
    const sessions = [makeSession('s1', 'e1'), makeSession('s2', 'e1')];
    vi.mocked(dbClient.listSessions).mockResolvedValue(sessions);
    vi.mocked(dbClient.listMessages).mockImplementation(async (sid: string) =>
      sid === 's1'
        ? [makeMessage('m1', 's1', 'e1'), makeMessage('m2', 's1', 'e1')]
        : [makeMessage('m3', 's2', 'e1')],
    );

    const { payload, stats } = await serializeChatPayload('e1');

    expect(payload.sessions).toHaveLength(2);
    expect(payload.messages).toHaveLength(3);
    expect(stats).toEqual({ sessionCount: 2, messageCount: 3 });
    expect(dbClient.listMessages).toHaveBeenCalledTimes(2);
  });
});

describe('serializeEntityPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the entity does not exist', async () => {
    vi.mocked(dbClient.getEntity).mockResolvedValue(null);
    await expect(serializeEntityPayload('missing')).rejects.toThrow(/Entity not found/);
  });

  it('assembles entity + chat + memory with stats.entityCount=1', async () => {
    vi.mocked(dbClient.getEntity).mockResolvedValue(makeEntity('e1'));
    vi.mocked(dbClient.listSessions).mockResolvedValue([makeSession('s1', 'e1')]);
    vi.mocked(dbClient.listMessages).mockResolvedValue([makeMessage('m1', 's1', 'e1')]);
    vi.mocked(dbClient.listMemoryEvents).mockResolvedValue([
      { id: 'ev1', entityId: 'e1' } as MemoryEventRow,
    ]);
    vi.mocked(dbClient.listMemoryFacts).mockResolvedValue([
      { id: 'f1', entityId: 'e1' } as MemoryFactRow,
    ]);
    vi.mocked(dbClient.listMemorySummaries).mockResolvedValue([
      { id: 'sum1', entityId: 'e1' } as MemorySummaryRow,
    ]);
    vi.mocked(dbClient.getRelationshipSnapshot).mockResolvedValue({
      id: 'rs1',
      entityId: 'e1',
    } as RelationshipSnapshotRow);
    vi.mocked(dbClient.listOpenLoops).mockResolvedValue([
      { id: 'l1', entityId: 'e1' } as OpenLoopRow,
    ]);

    const { payload, stats } = await serializeEntityPayload('e1');

    expect(payload.entity.id).toBe('e1');
    expect(payload.chat.sessions).toHaveLength(1);
    expect(payload.chat.messages).toHaveLength(1);
    expect(payload.memory.events).toHaveLength(1);
    expect(payload.memory.facts).toHaveLength(1);
    expect(payload.memory.summaries).toHaveLength(1);
    expect(payload.memory.relationshipSnapshots).toHaveLength(1);
    expect(payload.memory.openLoops).toHaveLength(1);
    expect(stats).toMatchObject({ entityCount: 1, sessionCount: 1, messageCount: 1 });
  });

  it('wraps a null relationship snapshot into [] (not [null])', async () => {
    vi.mocked(dbClient.getEntity).mockResolvedValue(makeEntity('e1'));
    vi.mocked(dbClient.listSessions).mockResolvedValue([]);
    vi.mocked(dbClient.listMessages).mockResolvedValue([]);
    vi.mocked(dbClient.listMemoryEvents).mockResolvedValue([]);
    vi.mocked(dbClient.listMemoryFacts).mockResolvedValue([]);
    vi.mocked(dbClient.listMemorySummaries).mockResolvedValue([]);
    vi.mocked(dbClient.getRelationshipSnapshot).mockResolvedValue(null);
    vi.mocked(dbClient.listOpenLoops).mockResolvedValue([]);

    const { payload } = await serializeEntityPayload('e1');
    expect(payload.memory.relationshipSnapshots).toEqual([]);
  });
});

describe('serializeConfigPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fans out provider→models and filters appConfig by known keys', async () => {
    vi.mocked(dbClient.listProviders).mockResolvedValue([
      { id: 'p1' } as ProviderRow,
      { id: 'p2' } as ProviderRow,
    ]);
    vi.mocked(dbClient.listModels).mockImplementation(async (pid: string) => [
      { id: `${pid}-m1` } as ProviderModelRow,
    ]);
    vi.mocked(dbClient.getUserProfile).mockResolvedValue({ id: 'u1' } as UserProfileRow);
    vi.mocked(dbClient.getConfig).mockImplementation(async (key: string) =>
      key === 'language' ? null : ({ key, value: 'v' } as AppConfigRow),
    );

    const { payload, stats } = await serializeConfigPayload();
    expect(payload.providers).toHaveLength(2);
    expect(payload.providerModels).toHaveLength(2);
    expect(payload.userProfile).not.toBeNull();
    // 3 config keys queried, 2 return values (language skipped as null).
    expect(payload.appConfig).toHaveLength(2);
    expect(stats.providerCount).toBe(2);
  });
});

describe('serializeFullPayload + serializeAllEntitiesPayload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits progress events for config then per-entity then a completion tick', async () => {
    vi.mocked(dbClient.listProviders).mockResolvedValue([]);
    vi.mocked(dbClient.getUserProfile).mockResolvedValue(null);
    vi.mocked(dbClient.getConfig).mockResolvedValue(null);

    vi.mocked(dbClient.listEntities).mockResolvedValue([makeEntity('e1'), makeEntity('e2')]);
    vi.mocked(dbClient.getEntity).mockImplementation(async (id: string) => makeEntity(id));
    vi.mocked(dbClient.listSessions).mockResolvedValue([]);
    vi.mocked(dbClient.listMessages).mockResolvedValue([]);
    vi.mocked(dbClient.listMemoryEvents).mockResolvedValue([]);
    vi.mocked(dbClient.listMemoryFacts).mockResolvedValue([]);
    vi.mocked(dbClient.listMemorySummaries).mockResolvedValue([]);
    vi.mocked(dbClient.getRelationshipSnapshot).mockResolvedValue(null);
    vi.mocked(dbClient.listOpenLoops).mockResolvedValue([]);

    const progress = vi.fn();
    const { payload, stats } = await serializeFullPayload(progress);

    expect(payload.entities).toHaveLength(2);
    expect(payload.config).toBeDefined();
    expect(stats.entityCount).toBe(2);

    const calls = progress.mock.calls.map((c) => c[0]);
    expect(calls).toContain('serializing-config');
    expect(calls).toContain('serializing-entities');
  });

  it('serializeAllEntitiesPayload skips config', async () => {
    vi.mocked(dbClient.listEntities).mockResolvedValue([makeEntity('e1')]);
    vi.mocked(dbClient.getEntity).mockResolvedValue(makeEntity('e1'));
    vi.mocked(dbClient.listSessions).mockResolvedValue([]);
    vi.mocked(dbClient.listMessages).mockResolvedValue([]);
    vi.mocked(dbClient.listMemoryEvents).mockResolvedValue([]);
    vi.mocked(dbClient.listMemoryFacts).mockResolvedValue([]);
    vi.mocked(dbClient.listMemorySummaries).mockResolvedValue([]);
    vi.mocked(dbClient.getRelationshipSnapshot).mockResolvedValue(null);
    vi.mocked(dbClient.listOpenLoops).mockResolvedValue([]);

    const { payload } = await serializeAllEntitiesPayload();
    expect(payload.entities).toHaveLength(1);
    expect('config' in payload).toBe(false);
  });
});
