'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { ConsciousnessEntity, QuestionnaireData, EntityType } from '@/types';
import * as dbClient from '@/lib/db/db-client';
import { useUserProfileStore } from '@/lib/store/user-profile-store';
// SU-ITER-090c · P2-01 — replace `as unknown as` and raw JSON.parse with
// Zod-validated parsers that return `null` on malformed / drifted rows
// and log structured warnings pointing at the offending row id.
// SU-ITER-092-batch3 · Nit cleanup — also import the two enum parsers so
// `entityType` / `status` are validated at the wire boundary instead of
// cast straight through `as EntityType`.
import {
  EMPTY_SOUL_DOCS,
  emptyQuestionnaire,
  parseEntityStatus,
  parseEntityType,
  safeParseQuestionnaire,
  safeParseSoulDocs,
} from './entity-schemas';
// SU-ITER-091-batch2 · P3-03 — consume the shared helper instead of
// redeclaring a local copy; chat-store does the same.
import { safeParseJson } from '@/lib/utils/safe-json';

// ============================================================
// Entity Store — Pure SQLite architecture via db-client.
// ============================================================

function entityToRow(entity: ConsciousnessEntity) {
  return {
    id: entity.id,
    name: entity.name,
    entityType: entity.type,
    status: entity.status,
    avatarData: entity.avatarUrl ?? null,
    questionnaireData: JSON.stringify(entity.questionnaire),
    soulDocs: JSON.stringify(entity.soulDocs),
    textMaterials: entity.textMaterials ? JSON.stringify(entity.textMaterials) : null,
    chatMaterials: entity.chatMaterials ? JSON.stringify(entity.chatMaterials) : null,
    webSearchMaterials: entity.webSearchMaterials ? JSON.stringify(entity.webSearchMaterials) : null,
    backgroundImage: entity.chatBackgroundImage ?? null,
    // Denormalized columns for future search/indexing — not read back by rowToEntity
    userCallName: entity.questionnaire?.step4?.userCallName ?? null,
    userPerception: entity.questionnaire?.step4?.userPerception ?? null,
    nickname: entity.questionnaire?.step1?.informalNickname ?? null,
    region: entity.questionnaire?.step1?.region ?? null,
    errorMessage: entity.errorMessage ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function rowToEntity(row: Record<string, unknown>): ConsciousnessEntity {
  // SU-ITER-090c · P2-01 — Zod-validate the two structured JSON columns
  // (questionnaireData / soulDocs) instead of trusting the shape.  On
  // parse failure we log + fall back to a fresh empty skeleton so a
  // corrupted row can't crash the store or silently poison downstream
  // prompts with nonsense fields.  Free-form materials stay on the
  // legacy `safeParseJson` path because their shape has no stable
  // invariants we can schema-enforce yet.
  //
  // Wire layer returns drizzle `$inferSelect` objects (camelCase) via
  // `NextResponse.json(rows)`; `snake_case` fallbacks are defensive only.
  const questionnaireRaw = (row.questionnaireData ?? row.questionnaire_data) as
    | string
    | null
    | undefined;
  const soulDocsRaw = (row.soulDocs ?? row.soul_docs) as string | null | undefined;
  const id = row.id as string;
  const questionnaire = safeParseQuestionnaire(questionnaireRaw, { source: id });
  const soulDocs = safeParseSoulDocs(soulDocsRaw, { source: id });

  return {
    id,
    name: row.name as string,
    type: parseEntityType(row.entityType ?? row.entity_type, { source: id }),
    status: parseEntityStatus(row.status, { source: id }),
    avatarUrl: (row.avatarData ?? row.avatar_data) as string | undefined,
    questionnaire: questionnaire ?? emptyQuestionnaire(),
    soulDocs: soulDocs ?? { ...EMPTY_SOUL_DOCS },
    textMaterials: safeParseJson(
      (row.textMaterials ?? row.text_materials) as string | null,
      undefined,
    ),
    chatMaterials: safeParseJson(
      (row.chatMaterials ?? row.chat_materials) as string | null,
      undefined,
    ),
    webSearchMaterials: safeParseJson(
      (row.webSearchMaterials ?? row.web_search_materials) as string | null,
      undefined,
    ),
    chatBackgroundImage: (row.backgroundImage ?? row.background_image) as string | undefined,
    errorMessage: (row.errorMessage ?? row.error_message) as string | undefined,
    createdAt: (row.createdAt ?? row.created_at) as string,
    updatedAt: (row.updatedAt ?? row.updated_at) as string,
  };
}

interface EntityState {
  entities: ConsciousnessEntity[];
  currentDraft: Partial<QuestionnaireData> | null;
  isLoading: boolean;
  loadEntities: () => Promise<void>;
  createEntity: (questionnaire: QuestionnaireData) => Promise<ConsciousnessEntity>;
  updateEntity: (id: string, updates: Partial<ConsciousnessEntity>) => Promise<void>;
  deleteEntity: (id: string) => Promise<void>;
  getEntity: (id: string) => Promise<ConsciousnessEntity | undefined>;
  saveDraft: (entityType: EntityType, draft: Partial<QuestionnaireData>) => Promise<void>;
  loadDraft: (entityType: EntityType) => Promise<Partial<QuestionnaireData> | null>;
  clearDraft: (entityType: EntityType) => Promise<void>;
}

export const useEntityStore = create<EntityState>((set, get) => ({
  entities: [],
  currentDraft: null,
  isLoading: false,

  loadEntities: async () => {
    set({ isLoading: true });
    try {
      const rows = await dbClient.listEntities();
      const entities = rows.map((r) => rowToEntity(r as unknown as Record<string, unknown>));
      entities.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      set({ entities, isLoading: false });
    } catch (e) {
      console.error('Failed to load entities:', e);
      set({ entities: [], isLoading: false });
    }
  },

  createEntity: async (questionnaire: QuestionnaireData) => {
    const entity: ConsciousnessEntity = {
      id: uuid(),
      name: questionnaire.step1.name,
      type: questionnaire.entityType,
      questionnaire,
      soulDocs: { ...EMPTY_SOUL_DOCS },
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await dbClient.upsertEntity(entityToRow(entity));
      set({ entities: [entity, ...get().entities] });
    } catch (e) {
      console.error('Failed to create entity:', e);
      throw e;
    }
    return entity;
  },

  updateEntity: async (id, updates) => {
    let existing = get().entities.find((e) => e.id === id);
    if (!existing) {
      const row = await dbClient.getEntity(id);
      if (row) existing = rowToEntity(row as unknown as Record<string, unknown>);
    }
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    try {
      await dbClient.upsertEntity(entityToRow(updated));
      const list = get().entities;
      const has = list.some((e) => e.id === id);
      set({ entities: has ? list.map((e) => (e.id === id ? updated : e)) : [updated, ...list] });
    } catch (e) {
      console.error('Failed to update entity:', e);
      throw e;
    }
  },

  deleteEntity: async (id) => {
    try {
      await dbClient.deleteEntity(id);
      set({ entities: get().entities.filter((e) => e.id !== id) });
      await useUserProfileStore.getState().pruneChatReplySelectionForDeletedEntity(id);
    } catch (e) {
      console.error('Failed to delete entity:', e);
      throw e;
    }
  },

  getEntity: async (id) => {
    const row = await dbClient.getEntity(id);
    return row ? rowToEntity(row as unknown as Record<string, unknown>) : undefined;
  },

  saveDraft: async (entityType, draft) => {
    try {
      await dbClient.upsertDraft({ id: `draft_${entityType}`, data: JSON.stringify(draft) });
      set({ currentDraft: draft });
    } catch (e) { console.error('Failed to save draft:', e); }
  },

  loadDraft: async (entityType) => {
    try {
      const row = await dbClient.getDraft(`draft_${entityType}`);
      if (!row) { set({ currentDraft: null }); return null; }
      const draft = safeParseJson<Partial<QuestionnaireData> | null>(row.data, null);
      set({ currentDraft: draft });
      return draft;
    } catch { return null; }
  },

  clearDraft: async (entityType) => {
    try {
      await dbClient.deleteDraft(`draft_${entityType}`);
    } catch (e) { console.error('Failed to clear draft:', e); }
    set({ currentDraft: null });
  },
}));
