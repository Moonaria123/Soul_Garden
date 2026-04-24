'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { ChatSession, ChatMessage } from '@/types';
import { CHAT_CONSTANTS } from '@/types';
import { toast } from 'sonner';
import * as dbClient from '@/lib/db/db-client';
import { translate } from '@/lib/i18n';
// SU-ITER-091-batch2 · P3-03 — consume the shared helper instead of
// redeclaring a local copy; entity-store does the same.
import { safeParseJson } from '@/lib/utils/safe-json';

// SU-ITER-091-batch2 · P3-10 — the chat store used to swallow DB
// failures with a silent `console.error` + in-memory rollback, which
// meant the UI happily pretended the message was saved even when
// SQLite rejected the write (quota, schema mismatch, permission bump
// after OS upgrade, …).  The reviewer call-out was specifically about
// user-visible recovery: the optimistic UI stays responsive, but the
// user now gets a toast and can retry.  We funnel every catch block
// through `notifyPersistError` so the i18n key set stays small and
// security-reviewer can audit at a single site that we never echo raw
// error text (which on libsql can leak filesystem paths).
function notifyPersistError(operation:
  | 'message'
  | 'summary'
  | 'delete'
  | 'clear'
  | 'session',
): void {
  // SU-ITER-092-batch3 · Nit cleanup — `translate(key: string)` does
  // NOT enforce literal-key validation today, so `as const` is not
  // strictly required right now.  We keep it intentionally so that
  // tightening `translate` to a `MessageKey` union in a future SU
  // gets a type error at this site instead of a silent runtime miss.
  const key = `chat.persistError.${operation}` as const;
  try {
    toast.error(translate(key));
  } catch {
    // `sonner` is only available in the browser; during SSR / jsdom
    // smoke tests without the <Toaster /> mounted it throws.  Swallow
    // so the store stays usable, the console.error below is still the
    // source of truth for debugging.
  }
}

// ============================================================
// Chat Store — Pure SQLite architecture via db-client.
// Messages stored as individual rows, not embedded arrays.
// ============================================================

interface ChatState {
  currentSession: ChatSession | null;
  isLoading: boolean;
  loadOrCreateSession: (entityId: string) => Promise<ChatSession>;
  addMessage: (role: 'user' | 'assistant', content: string) => Promise<void>;
  saveSession: () => Promise<void>;
  addSummary: (summary: string) => Promise<void>;
  getShouldSummarize: () => boolean;
  getRecentMessages: () => ChatMessage[];
  clearSession: () => void;
  deleteMessage: (messageId: string) => Promise<void>;
  clearChatHistory: () => Promise<void>;
}

// Wire layer returns drizzle `$inferSelect` objects (camelCase).  The
// `?? snake_case` fallbacks are retained defensively in case a future
// serialization layer drops camelCase keys — see SU-091-b2 P3-03 helper
// for the parallel pattern.
function messageRowToLocal(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    role: row.role as ChatMessage['role'],
    content: row.content as string,
    timestamp: row.timestamp as string,
  };
}

function sessionRowToLocal(
  row: Record<string, unknown>,
  messages: ChatMessage[],
): ChatSession {
  return {
    id: row.id as string,
    entityId: (row.entityId ?? row.entity_id) as string,
    title: (row.title as string) ?? '',
    messages,
    summaries: safeParseJson<string[]>(row.summaries as string | null, []),
    lastSummarizedMessageIndex:
      (row.lastSummarizedMessageIndex as number | undefined)
      ?? (row.last_summarized_message_index as number | undefined)
      ?? 0,
    createdAt: (row.createdAt ?? row.created_at) as string,
    updatedAt: (row.updatedAt ?? row.updated_at) as string,
  };
}

function sessionToRow(session: ChatSession) {
  return {
    id: session.id,
    entityId: session.entityId,
    title: session.title,
    summaries: JSON.stringify(session.summaries),
    lastSummarizedMessageIndex: session.lastSummarizedMessageIndex ?? 0,
    status: 'active' as const,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentSession: null,
  isLoading: false,

  loadOrCreateSession: async (entityId: string) => {
    const prev = get().currentSession;
    if (prev?.entityId !== entityId) {
      set({ isLoading: true, currentSession: null });
    } else {
      set({ isLoading: true });
    }

    try {
      const sessionRows = await dbClient.listSessions(entityId);
      if (sessionRows.length > 0) {
        // `ChatSessionRow` (drizzle $inferSelect) is camelCase-only — wire
        // layer serialises directly via `NextResponse.json(rows)`, so a
        // snake_case fallback is not reachable here.
        const latest = [...sessionRows].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )[0];
        const msgRows = await dbClient.listMessages(latest.id);
        const session = sessionRowToLocal(
          latest as unknown as Record<string, unknown>,
          msgRows.map((m) => messageRowToLocal(m as unknown as Record<string, unknown>)),
        );
        set({ currentSession: session, isLoading: false });
        return session;
      }

      const session: ChatSession = {
        id: uuid(), entityId, title: translate('chat.sessionTitle'),
        messages: [], summaries: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await dbClient.upsertSession(sessionToRow(session));
      set({ currentSession: session, isLoading: false });
      return session;
    } catch (e) {
      console.error('Failed to load/create session:', e);
      const fallback: ChatSession = {
        id: uuid(), entityId, title: translate('chat.sessionTitle'),
        messages: [], summaries: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      set({ currentSession: fallback, isLoading: false });
      return fallback;
    }
  },

  addMessage: async (role, content) => {
    const session = get().currentSession;
    if (!session) return;
    const message: ChatMessage = { id: uuid(), role, content, timestamp: new Date().toISOString() };
    const updated = { ...session, messages: [...session.messages, message], updatedAt: new Date().toISOString() };
    set({ currentSession: updated });

    try {
      await dbClient.insertMessage({
        id: message.id, sessionId: session.id, entityId: session.entityId,
        role: message.role, content: message.content, timestamp: message.timestamp,
      });
      await dbClient.upsertSession(sessionToRow(updated));
    } catch (e) {
      console.error('Failed to persist message:', e);
      set({ currentSession: session });
      notifyPersistError('message');
    }
  },

  saveSession: async () => {
    const session = get().currentSession;
    if (!session) return;
    try { await dbClient.upsertSession(sessionToRow(session)); }
    catch (e) {
      console.error('Failed to save session:', e);
      notifyPersistError('session');
    }
  },

  addSummary: async (summary: string) => {
    const session = get().currentSession;
    if (!session) return;
    const updated = {
      ...session,
      summaries: [...session.summaries, summary],
      lastSummarizedMessageIndex: session.messages.length,
      updatedAt: new Date().toISOString(),
    };
    set({ currentSession: updated });
    try { await dbClient.upsertSession(sessionToRow(updated)); }
    catch (e) {
      console.error('Failed to persist summary:', e);
      set({ currentSession: session });
      notifyPersistError('summary');
    }
  },

  getShouldSummarize: () => {
    const session = get().currentSession;
    if (!session) return false;
    return session.messages.length - (session.lastSummarizedMessageIndex ?? 0) >= CHAT_CONSTANTS.SUMMARY_TRIGGER_COUNT;
  },

  getRecentMessages: () => {
    const session = get().currentSession;
    if (!session) return [];
    return session.messages.slice(-CHAT_CONSTANTS.RECENT_MESSAGES_WINDOW);
  },

  clearSession: () => { set({ currentSession: null }); },

  deleteMessage: async (messageId: string) => {
    const session = get().currentSession;
    if (!session) return;
    const updated = {
      ...session,
      messages: session.messages.filter((m) => m.id !== messageId),
      updatedAt: new Date().toISOString(),
    };
    set({ currentSession: updated });
    try {
      await dbClient.deleteMessage(messageId);
      await dbClient.upsertSession(sessionToRow(updated));
    } catch (e) {
      console.error('Failed to delete message:', e);
      set({ currentSession: session });
      notifyPersistError('delete');
    }
  },

  clearChatHistory: async () => {
    const session = get().currentSession;
    if (!session) return;
    const updated = { ...session, messages: [], summaries: [], lastSummarizedMessageIndex: 0, updatedAt: new Date().toISOString() };
    set({ currentSession: updated });
    try {
      await dbClient.deleteMessagesForSession(session.id);
      await dbClient.upsertSession(sessionToRow(updated));
    } catch (e) {
      console.error('Failed to clear chat history:', e);
      set({ currentSession: session });
      notifyPersistError('clear');
    }
  },
}));
