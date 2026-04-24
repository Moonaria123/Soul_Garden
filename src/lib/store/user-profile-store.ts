'use client';

import { create } from 'zustand';
import type { UserProfile } from '@/types';
import * as dbClient from '@/lib/db/db-client';

// ============================================================
// User Profile Store — Pure SQLite architecture via db-client.
// ============================================================

interface UserProfileState {
  profile: UserProfile | null;
  isLoading: boolean;
  loadProfile: () => Promise<void>;
  saveProfile: (updates: Partial<Omit<UserProfile, 'id'>>) => Promise<void>;
  pruneChatReplySelectionForDeletedEntity: (entityId: string) => Promise<void>;
}

const PROFILE_ID = 'global-user-profile';

function rowToProfile(row: Record<string, unknown>): UserProfile {
  // Wire layer returns drizzle `$inferSelect` objects (camelCase);
  // snake_case fallbacks are retained defensively.
  const profile: UserProfile = {
    id: PROFILE_ID,
    displayName: (row.displayName ?? row.display_name) as string | undefined,
    nickname: row.nickname as string | undefined,
    age: row.age as string | undefined,
    gender: row.gender as string | undefined,
    personality: row.personality as string | undefined,
    bio: row.bio as string | undefined,
    avatarUrl: (row.avatarData ?? row.avatar_data) as string | undefined,
    updatedAt: ((row.updatedAt ?? row.updated_at) as string | undefined)
      ?? new Date().toISOString(),
  };
  const rawStyle = (row.chatReplyStyle ?? row.chat_reply_style) as string | undefined;
  if (rawStyle) {
    try { Object.assign(profile, JSON.parse(rawStyle)); } catch { /* not JSON */ }
  }
  return profile;
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: null,
  isLoading: false,

  loadProfile: async () => {
    set({ isLoading: true });
    try {
      const row = await dbClient.getUserProfile(PROFILE_ID);
      set({
        profile: row
          ? rowToProfile(row as unknown as Record<string, unknown>)
          : null,
        isLoading: false,
      });
    } catch { set({ isLoading: false }); }
  },

  saveProfile: async (updates) => {
    const current = get().profile;
    const profile: UserProfile = {
      id: PROFILE_ID,
      avatarUrl: current?.avatarUrl, displayName: current?.displayName,
      nickname: current?.nickname, age: current?.age, gender: current?.gender,
      personality: current?.personality, bio: current?.bio,
      chatReplyEnableActions: current?.chatReplyEnableActions,
      chatReplyEnableExpressions: current?.chatReplyEnableExpressions,
      chatReplySentenceCount: current?.chatReplySentenceCount,
      chatReplyStreamingBubbles: current?.chatReplyStreamingBubbles,
      chatReplyScope: current?.chatReplyScope,
      chatReplySelectedEntityIds: current?.chatReplySelectedEntityIds,
      updatedAt: new Date().toISOString(),
      ...updates,
    };

    try {
      await dbClient.upsertUserProfile({
        id: PROFILE_ID,
        displayName: profile.displayName ?? null, nickname: profile.nickname ?? null,
        age: profile.age ?? null, gender: profile.gender ?? null,
        personality: profile.personality ?? null, bio: profile.bio ?? null,
        avatarData: profile.avatarUrl ?? null,
        chatReplyStyle: JSON.stringify({
          chatReplyEnableActions: profile.chatReplyEnableActions,
          chatReplyEnableExpressions: profile.chatReplyEnableExpressions,
          chatReplySentenceCount: profile.chatReplySentenceCount,
          chatReplyStreamingBubbles: profile.chatReplyStreamingBubbles,
          chatReplyScope: profile.chatReplyScope,
          chatReplySelectedEntityIds: profile.chatReplySelectedEntityIds,
        }),
      });
    } catch (e) { console.error('Failed to save profile:', e); throw e; }
    set({ profile });
  },

  pruneChatReplySelectionForDeletedEntity: async (entityId) => {
    let current = get().profile;
    if (!current) { await get().loadProfile(); current = get().profile; }
    if (!current) return;
    const ids = current.chatReplySelectedEntityIds ?? [];
    if (!ids.includes(entityId)) return;
    await get().saveProfile({ chatReplySelectedEntityIds: ids.filter((x) => x !== entityId) });
  },
}));
