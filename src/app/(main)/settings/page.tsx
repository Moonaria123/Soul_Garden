'use client';

import { useEffect, useState } from 'react';
import { useProviderStore } from '@/lib/store/provider-store';
import type { LLMProvider } from '@/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Plus,
  Flame,
  Plug,
  ArrowLeft,
  Check,
  Globe,
  MessageCircle,
  Zap,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { useLocaleStore } from '@/lib/i18n';
import { SearchToolsConfigCard } from '@/components/settings/search-tools-config';
import { SearchWhitelistCard } from '@/components/settings/search-whitelist-config';
import { BackupSettingsCard } from '@/components/settings/backup-settings-card';
import { SessionSettingsCard } from '@/components/settings/session-settings-card';
import { AccountSecurityCard } from '@/components/settings/account-security-card';
import { ModelConfigCard } from '@/components/settings/model-config-card';
import { ProviderCard } from '@/components/settings/provider-card';
import { ProviderFormDialog } from '@/components/settings/provider-form-dialog';
import { useUserProfileStore } from '@/lib/store/user-profile-store';
import { useEntityStore } from '@/lib/store/entity-store';
import { DEFAULT_CHAT_REPLY_STYLE, type ChatReplyScope } from '@/types';

export default function SettingsPage() {
  const t = useT();
  const {
    providers,
    activeModelConfig,
    isLoading,
    loadProviders,
    addProvider,
    deleteProvider,
    setDefaultProvider,
    setActiveModelConfig,
    testConnection,
    getDecryptedApiKey,
    updateProvider,
    syncModelsFromUpstream,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editProvider, setEditProvider] = useState<LLMProvider | null>(null);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  return (
    <div className="container max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/home">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-display)]">{t('settings.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
      </div>

      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg">{t('settings.providers')}</CardTitle>
            <CardDescription>{t('settings.providers.desc')}</CardDescription>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> {t('settings.add')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <ProviderFormDialog
                onSave={async (opts) => {
                  if (!opts.apiKey) return;
                  const provider = await addProvider({
                    name: opts.name,
                    baseURL: opts.baseURL,
                    apiKey: opts.apiKey,
                    apiType: opts.apiType,
                    enabled: opts.enabled,
                  });
                  await syncModelsFromUpstream(provider.id);
                  await loadProviders();
                  setShowAddDialog(false);
                }}
                onCancel={() => setShowAddDialog(false)}
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Flame className="h-4 w-4 animate-[breathe_2s_ease-in-out_infinite] text-primary mr-2" />
              {t('settings.loading')}
            </div>
          )}
          {!isLoading && providers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Plug className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>{t('settings.empty')}</p>
              <p className="text-xs mt-1">{t('settings.empty.desc')}</p>
            </div>
          )}
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onDelete={() => deleteProvider(provider.id)}
              onSetDefault={() => setDefaultProvider(provider.id)}
              onEdit={() => setEditProvider(provider)}
              onTest={async () => {
                const key = await getDecryptedApiKey(provider);
                const result = await testConnection(provider.baseURL, key, provider.apiType);
                if (!result.ok) {
                  const keyHint = `key: ${key.slice(0, 6)}…(${key.length} chars)`;
                  result.detail = result.detail
                    ? `${keyHint} | ${result.detail}`
                    : keyHint;
                }
                return result;
              }}
              onSync={async () => {
                return syncModelsFromUpstream(provider.id);
              }}
              onToggleEnabled={async () => {
                await updateProvider(provider.id, { enabled: !provider.enabled });
              }}
            />
          ))}
        </CardContent>
      </Card>

      <Dialog open={editProvider !== null} onOpenChange={(open) => !open && setEditProvider(null)}>
        <DialogContent>
          {editProvider && (
            <ProviderFormDialog
              mode="edit"
              initial={editProvider}
              onSave={async (opts) => {
                await updateProvider(editProvider.id, {
                  name: opts.name,
                  baseURL: opts.baseURL,
                  apiType: opts.apiType,
                  enabled: opts.enabled,
                  ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
                });
                await loadProviders();
                setEditProvider(null);
              }}
              onCancel={() => setEditProvider(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Model Configuration (FR-402) */}
      {providers.length > 0 && (
        <ModelConfigCard
          providers={providers}
          activeModelConfig={activeModelConfig}
          onConfigChange={setActiveModelConfig}
        />
      )}

      {/* Language Configuration (SU-ITER-017) */}
      <LanguageConfigCard />

      {/* Consciousness chat reply shape (SU-ITER-065) */}
      <ChatReplyStyleCard />

      {/* Web Search Tools (V1.2) */}
      <SearchToolsConfigCard />

      {/* Web Search URL Whitelist (V1.2) */}
      <SearchWhitelistCard />

      {/* Backup & Restore (SU-ITER-081/082/083) */}
      <BackupSettingsCard />

      {/* Session & Security (SU-ITER-087) */}
      <SessionSettingsCard />

      {/* Account Security — change-password entry (SU-ITER-090a · R13) */}
      <AccountSecurityCard />

      <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-3 text-xs text-muted-foreground">
        <span>{t('settings.securityNote')}</span>
      </div>
    </div>
  );
}

// --- Language Configuration Card (SU-ITER-017) ---

function LanguageConfigCard() {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Globe className="h-4 w-4" /> {t('settings.language')}
        </CardTitle>
        <CardDescription>{t('settings.language.desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Label>{t('settings.language.label')}</Label>
          <Select
            value={locale}
            onValueChange={(v) => setLocale(v as 'zh-CN' | 'en')}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function ChatReplyStyleCard() {
  const t = useT();
  const { profile, loadProfile, saveProfile } = useUserProfileStore();
  const { entities, loadEntities } = useEntityStore();

  useEffect(() => {
    void loadProfile();
    void loadEntities();
  }, [loadProfile, loadEntities]);

  const actionsOn = profile?.chatReplyEnableActions ?? DEFAULT_CHAT_REPLY_STYLE.enableActions;
  const expressionsOn = profile?.chatReplyEnableExpressions ?? DEFAULT_CHAT_REPLY_STYLE.enableExpressions;
  const sentenceCount = Math.min(
    5,
    Math.max(1, profile?.chatReplySentenceCount ?? DEFAULT_CHAT_REPLY_STYLE.maxSentencesPerReply)
  );
  const streamingOn = profile?.chatReplyStreamingBubbles ?? DEFAULT_CHAT_REPLY_STYLE.streamingBubbles;
  const scope: ChatReplyScope = profile?.chatReplyScope ?? DEFAULT_CHAT_REPLY_STYLE.scope;
  const selectedIds: string[] = profile?.chatReplySelectedEntityIds ?? [];
  const readyEntities = entities.filter((e) => e.status === 'ready');

  const toggleEntity = (eid: string) => {
    const next = selectedIds.includes(eid)
      ? selectedIds.filter((x) => x !== eid)
      : [...selectedIds, eid];
    void saveProfile({ chatReplySelectedEntityIds: next });
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageCircle className="h-4 w-4" /> {t('settings.chatReply.title')}
        </CardTitle>
        <CardDescription>{t('settings.chatReply.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Actions toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chat-reply-actions">{t('settings.chatReply.actions')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.chatReply.actions.desc')}</p>
          </div>
          <Switch
            id="chat-reply-actions"
            checked={actionsOn}
            onCheckedChange={(v) => void saveProfile({ chatReplyEnableActions: v })}
          />
        </div>
        {/* Expressions toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chat-reply-expressions">{t('settings.chatReply.expressions')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.chatReply.expressions.desc')}</p>
          </div>
          <Switch
            id="chat-reply-expressions"
            checked={expressionsOn}
            onCheckedChange={(v) => void saveProfile({ chatReplyEnableExpressions: v })}
          />
        </div>
        {/* Sentence count slider */}
        <div className="space-y-3">
          <div className="space-y-0.5">
            <Label>{t('settings.chatReply.sentences')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.chatReply.sentences.desc')}</p>
          </div>
          <div className="flex items-center gap-4">
            <Slider
              className="flex-1"
              min={1}
              max={5}
              step={1}
              value={[sentenceCount]}
              onValueChange={(v) => {
                const n = v[0] ?? 1;
                void saveProfile({ chatReplySentenceCount: n });
              }}
            />
            <span className="tabular-nums text-sm text-muted-foreground w-8 text-right">{sentenceCount}</span>
          </div>
        </div>
        {/* Streaming bubbles toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chat-reply-streaming" className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              {t('settings.chatReply.streaming')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('settings.chatReply.streaming.desc')}</p>
          </div>
          <Switch
            id="chat-reply-streaming"
            checked={streamingOn}
            disabled={sentenceCount <= 1}
            onCheckedChange={(v) => void saveProfile({ chatReplyStreamingBubbles: v })}
          />
        </div>

        <Separator />

        {/* Scope selector */}
        <div className="space-y-3">
          <div className="space-y-0.5">
            <Label className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {t('settings.chatReply.scope')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('settings.chatReply.scope.desc')}</p>
          </div>
          <Select
            value={scope}
            onValueChange={(v) => void saveProfile({ chatReplyScope: v as ChatReplyScope })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">{t('settings.chatReply.scope.global')}</SelectItem>
              <SelectItem value="selected">{t('settings.chatReply.scope.selected')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Entity picker (visible when scope = selected) */}
        {scope === 'selected' && (
          <div className="space-y-2">
            <Label className="text-sm">{t('settings.chatReply.scope.pick')}</Label>
            {readyEntities.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('settings.chatReply.scope.noEntities')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {readyEntities.map((ent) => {
                  const active = selectedIds.includes(ent.id);
                  return (
                    <Badge
                      key={ent.id}
                      variant={active ? 'default' : 'outline'}
                      className="cursor-pointer select-none transition-colors"
                      onClick={() => toggleEntity(ent.id)}
                    >
                      {active && <Check className="h-3 w-3 mr-1" />}
                      {ent.name}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
