'use client';

// SU-088 P0-F: extracted from (main)/settings/page.tsx.
// Owns the per-provider row: status badges, test / sync buttons,
// enable toggle, and embedded model-management dialog.

import { useState } from 'react';
import type { LLMProvider } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Check,
  Flame,
  Pencil,
  RefreshCw,
  Settings2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ModelManageDialog } from './model-manage-dialog';

export function ProviderCard({
  provider,
  onDelete,
  onSetDefault,
  onEdit,
  onTest,
  onSync,
  onToggleEnabled,
}: {
  provider: LLMProvider;
  onDelete: () => void;
  onSetDefault: () => void;
  onEdit: () => void;
  onTest: () => Promise<{ ok: boolean; error?: string; hint?: string; detail?: string }>;
  onSync: () => Promise<{ count: number; error?: string; listHint?: string }>;
  onToggleEnabled: () => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; error?: string; hint?: string; detail?: string } | null
  >(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<
    { count: number; error?: string; listHint?: string } | null
  >(null);
  const [showManage, setShowManage] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest();
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await onSync();
      setSyncResult(result);
    } finally {
      setSyncing(false);
    }
  };

  const isDisabled = provider.enabled === false;

  return (
    <>
      <div
        className={`rounded-lg border border-border/50 bg-secondary/20 px-4 py-3 ${
          isDisabled ? 'opacity-50' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{provider.name}</span>
              {provider.isDefault && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Star className="h-3 w-3" /> {t('settings.default')}
                </Badge>
              )}
              {provider.apiType && provider.apiType !== 'openai-compatible' && (
                <Badge variant="outline" className="text-[10px]">
                  {t(`settings.form.apiType.${provider.apiType === 'openai' ? 'openai' : 'anthropic'}`)}
                </Badge>
              )}
              {isDisabled && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {t('settings.providerDisabled')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{provider.baseURL}</p>
            {provider.models.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {provider.models
                  .filter((m) => m.enabled !== false)
                  .slice(0, 5)
                  .map((m) => (
                    <Badge key={m.id} variant="outline" className="text-[10px] px-1.5 py-0">
                      {m.alias || m.id}
                    </Badge>
                  ))}
                {provider.models.filter((m) => m.enabled !== false).length > 5 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    +{provider.models.filter((m) => m.enabled !== false).length - 5}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onEdit} title={t('settings.editProvider')}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTest}
              disabled={testing}
              title={t('settings.test')}
            >
              {testing ? (
                <Flame className="h-3.5 w-3.5 animate-[breathe_2s_ease-in-out_infinite] text-primary" />
              ) : testResult?.ok ? (
                <Check className="h-3.5 w-3.5 text-[hsl(var(--su-success))]" />
              ) : testResult && !testResult.ok ? (
                <X className="h-3.5 w-3.5 text-destructive" />
              ) : (
                t('settings.test')
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              title={t('settings.syncModels')}
            >
              {syncing ? (
                <Flame className="h-3.5 w-3.5 animate-[breathe_2s_ease-in-out_infinite] text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManage(true)}
              title={t('settings.manageModels')}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
            <Switch
              checked={provider.enabled !== false}
              onCheckedChange={onToggleEnabled}
              className="scale-75"
            />
            {!provider.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSetDefault}
                title={t('settings.setDefault')}
              >
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Test result feedback */}
        {testResult && !testResult.ok && testResult.error && (
          <div className="mt-2 rounded bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <div>{testResult.error}</div>
            {testResult.detail && (
              <p className="mt-1 text-muted-foreground italic">{testResult.detail}</p>
            )}
            {/401|403|Authentication failed/i.test(testResult.error) && (
              <p className="mt-1.5 text-muted-foreground">{t('settings.authErrorHint')}</p>
            )}
          </div>
        )}
        {testResult?.ok && (
          <div className="mt-2 rounded bg-[hsl(var(--su-success))]/10 px-3 py-1.5 text-xs text-[hsl(var(--su-success))] space-y-1">
            <div>{t('settings.test.success')}</div>
            {testResult.hint && (
              <p className="text-muted-foreground font-normal">{testResult.hint}</p>
            )}
          </div>
        )}

        {/* Sync result feedback */}
        {syncResult && !syncResult.error && (
          <div className="mt-2 rounded bg-[hsl(var(--su-success))]/10 px-3 py-1.5 text-xs text-[hsl(var(--su-success))] space-y-1">
            <div>{t('settings.syncModels.success').replace('{count}', String(syncResult.count))}</div>
            {syncResult.listHint && (
              <p className="text-muted-foreground font-normal">{syncResult.listHint}</p>
            )}
          </div>
        )}
        {syncResult?.error && (
          <div className="mt-2 rounded bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <div>{t('settings.syncModels.failed').replace('{error}', syncResult.error)}</div>
            {/401|403|Authentication failed/i.test(syncResult.error) && (
              <p className="mt-1.5 text-muted-foreground">{t('settings.authErrorHint')}</p>
            )}
          </div>
        )}
      </div>

      {/* Model Management Dialog */}
      <ModelManageDialog provider={provider} open={showManage} onOpenChange={setShowManage} />
    </>
  );
}
