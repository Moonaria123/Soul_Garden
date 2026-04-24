'use client';

import * as dbClient from '@/lib/db/db-client';
import type {
  ChatBackupPayload,
  EntityBackupPayload,
  ConfigBackupPayload,
  GlobalBackupPayload,
  BackupStats,
} from './backup-format';
import type { BackupProgressCallback } from './backup-progress';
import { noopProgress } from './backup-progress';

// ============================================================
// Backup Serializer — extracts data from DB for backup
// ============================================================

export async function serializeChatPayload(
  entityId: string,
): Promise<{ payload: ChatBackupPayload; stats: BackupStats }> {
  const sessions = await dbClient.listSessions(entityId);

  // SU-ITER-091-batch1 · code-N-5 — inherit the row type from
  // `dbClient.listMessages` instead of the old `any[]` scratchpad.
  const allMessages: Awaited<ReturnType<typeof dbClient.listMessages>> = [];
  for (const session of sessions) {
    const msgs = await dbClient.listMessages(session.id);
    allMessages.push(...msgs);
  }

  return {
    payload: { sessions, messages: allMessages },
    stats: {
      sessionCount: sessions.length,
      messageCount: allMessages.length,
    },
  };
}

export async function serializeEntityPayload(
  entityId: string,
): Promise<{ payload: EntityBackupPayload; stats: BackupStats }> {
  const entity = await dbClient.getEntity(entityId);
  if (!entity) throw new Error(`Entity not found: ${entityId}`);

  const { payload: chat, stats: chatStats } = await serializeChatPayload(entityId);

  const [events, facts, summaries, relationshipSnapshots, openLoops] = await Promise.all([
    dbClient.listMemoryEvents(entityId),
    dbClient.listMemoryFacts(entityId),
    dbClient.listMemorySummaries(entityId),
    dbClient.getRelationshipSnapshot(entityId),
    dbClient.listOpenLoops(entityId),
  ]);

  return {
    payload: {
      entity,
      chat,
      memory: {
        events,
        facts,
        summaries,
        relationshipSnapshots: relationshipSnapshots ? [relationshipSnapshots] : [],
        openLoops,
      },
    },
    stats: {
      entityCount: 1,
      ...chatStats,
    },
  };
}

export async function serializeConfigPayload(): Promise<{
  payload: ConfigBackupPayload;
  stats: BackupStats;
}> {
  const providers = await dbClient.listProviders();

  // SU-ITER-091-batch1 · code-N-5 — inherit row types from dbClient.
  const allModels: Awaited<ReturnType<typeof dbClient.listModels>> = [];
  for (const p of providers) {
    const models = await dbClient.listModels(p.id);
    allModels.push(...models);
  }

  const userProfile = await dbClient.getUserProfile();

  const configKeys = ['activeModelConfig', 'searchConfig', 'language'];
  const appConfig: NonNullable<Awaited<ReturnType<typeof dbClient.getConfig>>>[] = [];
  for (const key of configKeys) {
    const val = await dbClient.getConfig(key);
    if (val) appConfig.push(val);
  }

  return {
    payload: {
      providers,
      providerModels: allModels,
      userProfile,
      appConfig,
    },
    stats: {
      providerCount: providers.length,
    },
  };
}

export async function serializeFullPayload(
  onProgress: BackupProgressCallback = noopProgress(),
): Promise<{ payload: GlobalBackupPayload; stats: BackupStats }> {
  onProgress('serializing-config', 0, 1);
  const { payload: config, stats: configStats } = await serializeConfigPayload();
  onProgress('serializing-config', 1, 1);

  const entities = await dbClient.listEntities();
  const entityPayloads: EntityBackupPayload[] = [];
  let totalSessions = 0;
  let totalMessages = 0;

  for (let i = 0; i < entities.length; i++) {
    onProgress('serializing-entities', i, entities.length);
    const { payload } = await serializeEntityPayload(entities[i].id);
    entityPayloads.push(payload);
    totalSessions += payload.chat.sessions.length;
    totalMessages += payload.chat.messages.length;
  }
  onProgress('serializing-entities', entities.length, entities.length);

  return {
    payload: { entities: entityPayloads, config },
    stats: {
      entityCount: entities.length,
      sessionCount: totalSessions,
      messageCount: totalMessages,
      ...configStats,
    },
  };
}

export async function serializeAllEntitiesPayload(
  onProgress: BackupProgressCallback = noopProgress(),
): Promise<{ payload: GlobalBackupPayload; stats: BackupStats }> {
  const entities = await dbClient.listEntities();
  const entityPayloads: EntityBackupPayload[] = [];
  let totalSessions = 0;
  let totalMessages = 0;

  for (let i = 0; i < entities.length; i++) {
    onProgress('serializing-entities', i, entities.length);
    const { payload } = await serializeEntityPayload(entities[i].id);
    entityPayloads.push(payload);
    totalSessions += payload.chat.sessions.length;
    totalMessages += payload.chat.messages.length;
  }
  onProgress('serializing-entities', entities.length, entities.length);

  return {
    payload: { entities: entityPayloads },
    stats: {
      entityCount: entities.length,
      sessionCount: totalSessions,
      messageCount: totalMessages,
    },
  };
}
