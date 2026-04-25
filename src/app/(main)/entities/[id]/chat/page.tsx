'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import type { ConsciousnessEntity } from '@/types';
import { useEntityStore } from '@/lib/store/entity-store';
import { useProviderStore } from '@/lib/store/provider-store';
import { useChatStore } from '@/lib/store/chat-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  MoreVertical,
  Trash2,
  ImageIcon,
  RotateCcw,
  Loader2,
  Download,
  Archive,
  ArchiveRestore,
  Sparkles,
} from 'lucide-react';
import {
  formatChatAsMarkdown,
  formatChatAsText,
  formatChatAsJson,
  downloadFile,
} from '@/lib/utils/chat-export';
import { toast } from 'sonner';
import { useLocaleStore, useT } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { EntityProfileDialog } from '@/components/entity/entity-profile-dialog';
import { useUserProfileStore } from '@/lib/store/user-profile-store';
import { RestoreConfirmDialog } from '@/components/backup/restore-confirm-dialog';
import { useLegacyBackupPasswordPrompt } from '@/components/backup/legacy-backup-password-dialog';
import {
  serializeChatPayload,
  createBackupZip,
  downloadBackupFile,
  generateBackupFilename,
  parseBackupPayload,
  restoreChatPayload,
  validateBackup,
  APP_VERSION,
  BACKUP_FORMAT_VERSION,
  V1BackupPasswordRequiredError,
  V1BackupDeriveFailedError,
  type BackupManifest,
  type RestoreStrategy,
  type ChatBackupPayload,
} from '@/lib/backup';
import Link from 'next/link';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ConversationMemorySheet } from '@/components/chat/conversation-memory-sheet';
import { useChatStream } from '@/lib/hooks/use-chat-stream';
import { validateImageFile } from '@/lib/utils/image-validation';

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const { getEntity, updateEntity } = useEntityStore();
  const { loadProviders } = useProviderStore();
  const {
    currentSession,
    isLoading: chatSessionLoading,
    loadOrCreateSession,
    addMessage,
    deleteMessage,
    clearChatHistory,
  } = useChatStore();
  const { profile: userProfile, loadProfile: loadUserProfile } = useUserProfileStore();
  const [entity, setEntity] = useState<ConsciousnessEntity | null>(null);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreManifest, setRestoreManifest] = useState<BackupManifest | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  // SU-ITER-091-batch3 — V1 backup compatibility prompt.  Safe on
  // every restore; the provider is only invoked when the manifest
  // reports kdfVersion === 'v1' (see parseBackupPayload).
  const { legacyPasswordProvider, dialog: legacyBackupDialog } =
    useLegacyBackupPasswordPrompt();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [memorySheetOpen, setMemorySheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const { isStreaming, streamingContent, sendMessage } = useChatStream({
    entity,
    userProfile,
  });

  // Init — reload session from SQLite immediately (do not clear on unmount: that hid history after navigation)
  useEffect(() => {
    loadProviders();
    loadUserProfile();
    void loadOrCreateSession(id);
    getEntity(id).then((e) => {
      if (!e || e.status !== 'ready') {
        router.replace(`/entities/${id}`);
        return;
      }
      setEntity(e);
    });
  }, [id, getEntity, loadProviders, loadOrCreateSession, loadUserProfile, router]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, streamingContent]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !entity || isStreaming) return;
    const userMessage = input.trim();
    setInput('');
    await addMessage('user', userMessage);
    await sendMessage(userMessage);
  }, [input, entity, isStreaming, addMessage, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Voice input using Web Speech API
  const toggleVoiceInput = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // Minimal shim for the non-standard Web Speech API — there are no
    // first-party lib.dom types for `webkitSpeechRecognition`, so we hand-roll
    // just the surface we use here.  Prefer `unknown` over `any`.
    interface SpeechResultAlt { transcript: string }
    interface SpeechResult { 0: SpeechResultAlt }
    interface SpeechRecognitionEvent { results: ArrayLike<SpeechResult> }
    interface SpeechRecognitionLike {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (event: SpeechRecognitionEvent) => void;
      onend: () => void;
      onerror: () => void;
      start: () => void;
    }
    interface WindowWithSpeech {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }

    const w = window as unknown as WindowWithSpeech;
    const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [isListening]);

  const handleBgUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !entity) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('chat.background.tooLarge'));
      if (bgInputRef.current) bgInputRef.current.value = '';
      return;
    }
    // SU-ITER-090a · P2-19 — MIME whitelist + magic-number validation.
    const v = await validateImageFile(file);
    if (!v.ok) {
      toast.error(t('chat.background.invalidType'));
      if (bgInputRef.current) bgInputRef.current.value = '';
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new window.Image();
        // SU-ITER-090c · P2-08 — revoke the object URL in every exit path
        // (load / error) so the Blob's memory can be reclaimed; otherwise
        // every background-image preview leaks a Blob until the tab unloads.
        const objectUrl = URL.createObjectURL(file);
        const cleanup = () => {
          try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
        };
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 1280;
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim / w, maxDim / h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            canvas.width = w;
            canvas.height = h;
            // SU-ITER-092-batch3 · A4-MEDIUM — `getContext('2d')`
            // technically returns `null` (e.g. in extremely sandboxed
            // browsers or when the canvas was adopted by a different
            // owning document).  Reject loudly instead of silently
            // encoding an empty blob.
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              throw new Error('canvas 2d context unavailable');
            }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/webp', 0.75));
          } finally {
            cleanup();
          }
        };
        img.onerror = () => {
          cleanup();
          reject(new Error('load'));
        };
        img.src = objectUrl;
      });
      await updateEntity(entity.id, { chatBackgroundImage: dataUrl });
      setEntity((prev) => prev ? { ...prev, chatBackgroundImage: dataUrl } : prev);
      toast.success(t('chat.background.updated'));
    } catch {
      toast.error(t('chat.background.failed'));
    }
    if (bgInputRef.current) bgInputRef.current.value = '';
  }, [entity, updateEntity, t]);

  const handleBgReset = useCallback(async () => {
    if (!entity) return;
    await updateEntity(entity.id, { chatBackgroundImage: undefined });
    setEntity((prev) => prev ? { ...prev, chatBackgroundImage: undefined } : prev);
    toast.success(t('chat.background.reset.done'));
  }, [entity, updateEntity, t]);

  const handleChatBackup = useCallback(async () => {
    if (!entity) return;
    setIsBackingUp(true);
    try {
      const { payload, stats } = await serializeChatPayload(entity.id);
      const payloadJson = JSON.stringify(payload);
      const blob = await createBackupZip(
        {
          version: BACKUP_FORMAT_VERSION,
          type: 'chat',
          scope: 'chat-only',
          appVersion: APP_VERSION,
          createdAt: new Date().toISOString(),
          entityId: entity.id,
          entityName: entity.name,
          encrypted: false,
          stats,
        },
        payloadJson,
      );
      const filename = generateBackupFilename('chat', 'chat-only', entity.name);
      downloadBackupFile(blob, filename);
      toast.success(t('backup.exportSuccess'));
    } catch (err) {
      toast.error(t('backup.restore.error', { error: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setIsBackingUp(false);
    }
  }, [entity, t]);

  const handleChatRestoreFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await validateBackup(file);
      if (!result.valid) {
        toast.error(t('backup.restore.invalidFile'));
        return;
      }
      // SU-ITER-091-batch1 mini-Gate · Concern-2 cleanup — see the
      // parallel fix in `restore-entity-dialog.tsx`.  The old `&&`
      // guard accepted `type='entity' + scope='chat-only'` too; if
      // that file were submitted in `overwrite` mode, `restoreChatPayload`
      // would execute the pre-delete branch (dropping every existing
      // chat session) and then crash on `payload.sessions` being
      // undefined — a bounded but real data-loss path.  `||` requires
      // both facets to match, aligning with the entity-restore flow.
      if (result.manifest.type !== 'chat' || result.manifest.scope !== 'chat-only') {
        toast.error(t('backup.restore.typeMismatch'));
        return;
      }
      setRestoreManifest(result.manifest);
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    } catch {
      toast.error(t('backup.restore.invalidFile'));
    }
    if (restoreInputRef.current) restoreInputRef.current.value = '';
  }, [t]);

  const handleChatRestoreConfirm = useCallback(async (opts: { chatStrategy?: RestoreStrategy }) => {
    if (!restoreFile || !entity) return;
    setShowRestoreConfirm(false);
    try {
      // SU-ITER-091-batch3 — wire the V1 backup password prompt so
      // legacy chat backups remain importable after migration-v2.
      // Same no-op for v2 backups as in BackupSettingsCard.
      const { payload } = await parseBackupPayload(restoreFile, {
        legacyPasswordProvider,
      });
      // SU-ITER-091-batch1 · code-N-5 — narrow the union return type;
      // the chat-only backup flow is gated upstream by manifest.scope.
      await restoreChatPayload(entity.id, payload as ChatBackupPayload, opts.chatStrategy ?? 'overwrite');
      await loadOrCreateSession(entity.id);
      toast.success(t('backup.restore.success'));
    } catch (err) {
      if (err instanceof V1BackupPasswordRequiredError) {
        toast.info(t('backup.restore.v1.cancelled'));
      } else if (err instanceof V1BackupDeriveFailedError) {
        const code = err.code;
        if (code === 'invalid_credentials') {
          toast.error(t('backup.restore.v1.invalidCredentials'));
        } else if (code === 'rate_limited') {
          toast.error(t('backup.restore.v1.rateLimited'));
        } else if (code === 'account_locked') {
          toast.error(t('backup.restore.v1.accountLocked'));
        } else {
          toast.error(t('backup.restore.v1.deriveFailed', { code }));
        }
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('Decryption') || msg.includes('decrypt')) {
          toast.error(t('backup.restore.decryptFailed'));
        } else {
          toast.error(t('backup.restore.error', { error: msg }));
        }
      }
    } finally {
      setRestoreFile(null);
      setRestoreManifest(null);
    }
  }, [restoreFile, entity, loadOrCreateSession, t, legacyPasswordProvider]);

  const hasSpeechAPI = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const PAGE_SIZE = 30;
  const allMessages = currentSession?.messages || [];
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Reset display count when session changes
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [currentSession?.id]);

  const messages = allMessages.slice(-displayCount);
  const hasOlderMessages = displayCount < allMessages.length;

  const loadingBatchRef = useRef(false);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const scrollRoot = scrollAreaRef.current;
    if (!sentinel || !scrollRoot || !hasOlderMessages) return;
    const viewport = scrollRoot.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null;
    if (!viewport) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingBatchRef.current) {
          loadingBatchRef.current = true;
          const prevHeight = viewport.scrollHeight;
          setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, allMessages.length));
          requestAnimationFrame(() => {
            const newHeight = viewport.scrollHeight;
            viewport.scrollTop += newHeight - prevHeight;
            loadingBatchRef.current = false;
          });
        }
      },
      { root: viewport, threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlderMessages, allMessages.length, displayCount]);

  const isEmpty =
    !chatSessionLoading &&
    allMessages.length === 0 &&
    !streamingContent;

  return (
    <div className="flex flex-col h-dvh bg-background relative">
      {entity?.chatBackgroundImage && (
        <>
          <div
            className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${entity.chatBackgroundImage})` }}
          />
          <div className="absolute inset-0 z-0 bg-background/40 backdrop-blur-[1px]" />
        </>
      )}
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3 bg-card/50 backdrop-blur-sm relative z-10 shrink-0">
        <Link href="/home">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <button
          type="button"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          onClick={() => entity && setShowProfile(true)}
        >
          {entity?.avatarUrl ? (
            <img src={entity.avatarUrl} alt={entity.name} className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-primary font-bold text-sm font-[family-name:var(--font-display)]">
              {entity?.name?.charAt(0) || '·'}
            </div>
          )}
          <div className="text-left">
            <h1 className="font-medium font-[family-name:var(--font-display)] text-sm">{entity?.name || t('chat.loading')}</h1>
            <p className="text-xs text-muted-foreground">
              {isStreaming ? t('chat.thinking') : t('chat.online')}
            </p>
          </div>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => bgInputRef.current?.click()}>
                <ImageIcon className="h-4 w-4 mr-2" />
                {t('chat.background.change')}
              </DropdownMenuItem>
              {entity?.chatBackgroundImage && (
                <DropdownMenuItem onClick={handleBgReset}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {t('chat.background.reset')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={allMessages.length === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('chat.exportTitle')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => {
                    if (!entity) return;
                    downloadFile(
                      formatChatAsMarkdown(entity.name, allMessages),
                      `${entity.name}-chat.md`,
                      'text/markdown'
                    );
                  }}>
                    {t('chat.exportMd')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    if (!entity) return;
                    downloadFile(
                      formatChatAsText(entity.name, allMessages),
                      `${entity.name}-chat.txt`,
                      'text/plain'
                    );
                  }}>
                    {t('chat.exportTxt')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    if (!entity) return;
                    downloadFile(
                      formatChatAsJson(entity.name, allMessages),
                      `${entity.name}-chat.json`,
                      'application/json'
                    );
                  }}>
                    {t('chat.exportJson')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                disabled={allMessages.length === 0 || isBackingUp}
                onClick={handleChatBackup}
              >
                <Archive className="h-4 w-4 mr-2" />
                {isBackingUp ? t('backup.exporting') : t('backup.chat.export')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => restoreInputRef.current?.click()}
              >
                <ArchiveRestore className="h-4 w-4 mr-2" />
                {t('backup.chat.import')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={allMessages.length === 0}
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('chat.clearHistory')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-normal hidden sm:inline-flex border-border/60 bg-card/40"
            onClick={() => setMemorySheetOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5 opacity-80" aria-hidden />
            {t('chat.memoryTimeline.open')}
          </Button>
          <LanguageSwitcher />
        </div>
      </div>

      <ConversationMemorySheet
        entityId={entity?.id ?? null}
        open={memorySheetOpen}
        onOpenChange={setMemorySheetOpen}
        refreshToken={
          (allMessages.at(-1)?.timestamp ?? '') + (currentSession?.id ?? '')
        }
      />

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 px-4 relative z-10" ref={scrollAreaRef as React.RefObject<HTMLDivElement>}>
        <div className="max-w-2xl mx-auto py-4 space-y-4">
          {/* Sentinel for loading older messages */}
          {hasOlderMessages && (
            <div ref={topSentinelRef} className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">{t('chat.loadingOlder')}</span>
            </div>
          )}
          {chatSessionLoading && messages.length === 0 && (
            <div className="flex items-center justify-center min-h-[40vh]">
              <p className="text-muted-foreground text-center text-sm animate-pulse">
                {t('chat.loading')}
              </p>
            </div>
          )}

          {isEmpty && (
            <div className="flex items-center justify-center min-h-[50vh]">
              <p className="text-muted-foreground text-center text-sm">
                {t('chat.emptyPrompt')}
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              entity={entity}
              userProfile={userProfile}
              locale={locale}
              onShowProfile={() => entity && setShowProfile(true)}
              onRequestDelete={setDeleteTarget}
            />
          ))}

          {/* Streaming message */}
          {streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-tl-md border border-border bg-[hsl(var(--su-surface-2))] px-4 py-2.5 text-sm text-foreground shadow-[var(--shadow-warm-sm)]">
                <p className="whitespace-pre-wrap">{streamingContent}</p>
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-border bg-[hsl(var(--su-surface-2))] px-4 py-2.5 text-sm text-muted-foreground shadow-[var(--shadow-warm-sm)]">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/60" style={{ animation: 'dot-breathing 1.8s ease-in-out infinite' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/60" style={{ animation: 'dot-breathing 1.8s ease-in-out 0.2s infinite' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/60" style={{ animation: 'dot-breathing 1.8s ease-in-out 0.4s infinite' }} />
                </div>
                {t('chat.thinking')}
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <ChatComposer
        ref={inputRef}
        input={input}
        onInputChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        isStreaming={isStreaming}
        hasSpeechAPI={hasSpeechAPI}
        isListening={isListening}
        onToggleVoice={toggleVoiceInput}
        entity={entity}
      />

      {/* Profile dialog (SU-ITER-041) */}
      {entity && (
        <EntityProfileDialog
          entity={entity}
          open={showProfile}
          onOpenChange={setShowProfile}
          onAvatarChange={async (dataUrl) => {
            await updateEntity(entity.id, { avatarUrl: dataUrl });
            setEntity((prev) => prev ? { ...prev, avatarUrl: dataUrl } : prev);
          }}
          onAvatarRemove={async () => {
            await updateEntity(entity.id, { avatarUrl: undefined });
            setEntity((prev) => prev ? { ...prev, avatarUrl: undefined } : prev);
          }}
          onEntityUpdate={async (updates) => {
            await updateEntity(entity.id, updates);
            setEntity((prev) => prev ? { ...prev, ...updates, updatedAt: new Date().toISOString() } : prev);
          }}
        />
      )}

      {/* Delete single message confirmation (SU-ITER-042) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.deleteMessage')}</AlertDialogTitle>
            <AlertDialogDescription>{t('chat.deleteMessage.confirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('chat.deleteMessage.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteTarget) {
                  await deleteMessage(deleteTarget);
                  toast.success(t('chat.deleteMessage.done'));
                  setDeleteTarget(null);
                }
              }}
            >
              {t('chat.deleteMessage.ok')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file input for chat background (SU-ITER-053) */}
      <input
        ref={bgInputRef}
        type="file"
        // SU-ITER-090a · P2-19 — aligned with validateImageFile whitelist.
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleBgUpload}
      />

      {/* Hidden file input for chat backup restore (SU-ITER-081) */}
      <input
        ref={restoreInputRef}
        type="file"
        accept=".soul-backup"
        className="hidden"
        onChange={handleChatRestoreFileSelect}
      />

      {/* Chat restore confirmation (SU-ITER-081) */}
      <RestoreConfirmDialog
        open={showRestoreConfirm}
        onOpenChange={setShowRestoreConfirm}
        manifest={restoreManifest}
        showChatStrategy
        onConfirm={handleChatRestoreConfirm}
      />

      {/* SU-ITER-091-batch3 — V1 backup password prompt.  Opens only
          when parseBackupPayload detects a v1 manifest. */}
      {legacyBackupDialog}

      {/* Clear all chat history confirmation (SU-ITER-042) */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.clearHistory')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chat.clearHistory.confirm', { name: entity?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('chat.clearHistory.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                await clearChatHistory();
                toast.success(t('chat.clearHistory.done'));
                setShowClearConfirm(false);
              }}
            >
              {t('chat.clearHistory.ok')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
