'use client';

import { create } from 'zustand';
import type { SessionSettings } from '@/types';
import {
  SESSION_SETTINGS_DEFAULTS,
  SESSION_SETTINGS_LIMITS,
} from '@/types';
import * as dbClient from '@/lib/db/db-client';

// ============================================================
// Session Settings Store (SU-087)
// Persists { autoLogoutEnabled, idleTimeoutMinutes, persistDEKThisTab }
// in the encrypted SQLite app_config table under key 'session-settings'.
// persistDEKThisTab is also mirrored to localStorage.su_persist_dek so
// the auth-store can consult it at login time (before db is unlocked).
// ============================================================

const CONFIG_KEY = 'session-settings';
const LS_PERSIST_DEK = 'su_persist_dek';

interface SessionSettingsState extends SessionSettings {
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (updates: Partial<SessionSettings>) => Promise<void>;
}

function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return SESSION_SETTINGS_DEFAULTS.idleTimeoutMinutes;
  const i = Math.round(n);
  return Math.max(
    SESSION_SETTINGS_LIMITS.idleTimeoutMinutesMin,
    Math.min(SESSION_SETTINGS_LIMITS.idleTimeoutMinutesMax, i),
  );
}

function sanitize(raw: Partial<SessionSettings> | null | undefined): SessionSettings {
  const merged = { ...SESSION_SETTINGS_DEFAULTS, ...(raw ?? {}) };
  return {
    autoLogoutEnabled: Boolean(merged.autoLogoutEnabled),
    idleTimeoutMinutes: clampMinutes(merged.idleTimeoutMinutes),
    persistDEKThisTab: Boolean(merged.persistDEKThisTab),
  };
}

function mirrorPersistDEK(persist: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (persist) {
      localStorage.setItem(LS_PERSIST_DEK, '1');
    } else {
      localStorage.removeItem(LS_PERSIST_DEK);
      // If the user just turned it OFF, also purge any already-persisted DEK
      // so the next refresh falls back to re-unlock flow.
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('su_dek_raw');
      }
    }
  } catch {
    /* noop */
  }
}

export const useSessionSettingsStore = create<SessionSettingsState>((set, get) => ({
  ...SESSION_SETTINGS_DEFAULTS,
  isLoaded: false,

  loadSettings: async () => {
    try {
      const row = await dbClient.getConfig(CONFIG_KEY);
      let parsed: Partial<SessionSettings> | null = null;
      if (row) {
        // app_config stores string value; try to parse JSON.
        const raw = typeof row === 'string' ? row : (row.value ?? row);
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          parsed = null;
        }
      }
      const settings = sanitize(parsed);
      mirrorPersistDEK(settings.persistDEKThisTab);
      set({ ...settings, isLoaded: true });
    } catch (e) {
      console.warn('[session-settings] load failed, using defaults:', e);
      mirrorPersistDEK(SESSION_SETTINGS_DEFAULTS.persistDEKThisTab);
      set({ ...SESSION_SETTINGS_DEFAULTS, isLoaded: true });
    }
  },

  saveSettings: async (updates) => {
    const current: SessionSettings = {
      autoLogoutEnabled: get().autoLogoutEnabled,
      idleTimeoutMinutes: get().idleTimeoutMinutes,
      persistDEKThisTab: get().persistDEKThisTab,
    };
    const next = sanitize({ ...current, ...updates });
    try {
      await dbClient.setConfig(CONFIG_KEY, JSON.stringify(next));
    } catch (e) {
      console.error('[session-settings] save failed:', e);
      throw e;
    }
    mirrorPersistDEK(next.persistDEKThisTab);
    set({ ...next });
  },
}));
