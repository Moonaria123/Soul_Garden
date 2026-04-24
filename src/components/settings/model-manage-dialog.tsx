'use client';

import { useState, useMemo } from 'react';
import type { LLMProvider, ModelInfo } from '@/types';
import { useProviderStore } from '@/lib/store/provider-store';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
// Badge is retained for context-window display; Switch for enable/disable toggle
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Flame, Plus, Trash2, Download, Check, Pencil, X } from 'lucide-react';

// ============================================================
// Model Management Dialog (SU-ITER-028)
// 3-section UI: fetch upstream, manual add, existing list
// ============================================================

interface ModelManageDialogProps {
  provider: LLMProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ModelManageDialog({ provider, open, onOpenChange }: ModelManageDialogProps) {
  const t = useT();
  const { fetchModels, getDecryptedApiKey, updateProvider } = useProviderStore();

  // --- Section 1: Fetch upstream ---
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);

  // --- Section 2: Manual add ---
  const [manualId, setManualId] = useState('');
  const [manualAlias, setManualAlias] = useState('');
  const [manualContext, setManualContext] = useState('');

  // --- Section 3: Existing models ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAlias, setEditAlias] = useState('');

  // Full-edit mode for an existing model (SU-ITER-074)
  const [fullEditId, setFullEditId] = useState<string | null>(null);
  const [feAlias, setFeAlias] = useState('');
  const [feContext, setFeContext] = useState('');

  // Current models on this provider (live from store)
  const currentProvider = useProviderStore((s) => s.providers.find((p) => p.id === provider.id)) ?? provider;
  const existingModels = currentProvider.models;
  const existingIds = useMemo(() => new Set(existingModels.map((m) => m.id)), [existingModels]);

  const handleFetchUpstream = async () => {
    setFetching(true);
    setFetchError(null);
    setFetchInfo(null);
    try {
      const apiKey = await getDecryptedApiKey(currentProvider);
      const { models, listHint } = await fetchModels(
        currentProvider.baseURL,
        apiKey,
        currentProvider.apiType
      );
      if (models.length > 0) {
        await updateProvider(currentProvider.id, { models });
        setFetchInfo(listHint || t('settings.models.fetchSuccess').replace('{count}', String(models.length)));
      } else {
        if (listHint) setFetchInfo(listHint);
        if (!listHint) setFetchError(t('settings.models.fetchEmpty'));
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setFetching(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualId.trim()) return;
    const newModel: ModelInfo = {
      id: manualId.trim(),
      alias: manualAlias.trim() || undefined,
      contextWindow: manualContext ? parseInt(manualContext, 10) : undefined,
      enabled: true,
      supportsThinking: false,
      supportsVision: false,
      supportsWebSearch: false,
      capabilities: { text: true, vision: false, thinking: false, webSearch: false },
    };
    const merged = [...existingModels, newModel];
    await updateProvider(currentProvider.id, { models: merged });
    setManualId('');
    setManualAlias('');
    setManualContext('');
  };

  const handleDeleteModel = async (modelId: string) => {
    const filtered = existingModels.filter((m) => m.id !== modelId);
    await updateProvider(currentProvider.id, { models: filtered });
  };

  const handleToggleModel = async (modelId: string) => {
    const updated = existingModels.map((m) =>
      m.id === modelId ? { ...m, enabled: !m.enabled } : m
    );
    await updateProvider(currentProvider.id, { models: updated });
  };

  const handleSaveAlias = async (modelId: string) => {
    const updated = existingModels.map((m) =>
      m.id === modelId ? { ...m, alias: editAlias.trim() || undefined } : m
    );
    await updateProvider(currentProvider.id, { models: updated });
    setEditingId(null);
  };

  const startFullEdit = (m: ModelInfo) => {
    setFullEditId(m.id);
    setFeAlias(m.alias || '');
    setFeContext(m.contextWindow ? String(m.contextWindow) : '');
    setEditingId(null);
  };

  const handleSaveFullEdit = async () => {
    if (!fullEditId) return;
    const updated = existingModels.map((m) =>
      m.id === fullEditId
        ? {
            ...m,
            alias: feAlias.trim() || undefined,
            contextWindow: feContext ? parseInt(feContext, 10) : undefined,
          }
        : m
    );
    await updateProvider(currentProvider.id, { models: updated });
    setFullEditId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('settings.models.title').replace('{provider}', currentProvider.name)}
          </DialogTitle>
        </DialogHeader>

        {/* Section 1: Fetch Upstream */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium">{t('settings.models.fetchUpstream')}</h4>
              <p className="text-xs text-muted-foreground">{t('settings.models.fetchUpstream.desc')}</p>
            </div>
            <Button size="sm" onClick={handleFetchUpstream} disabled={fetching}>
              {fetching ? (
                <Flame className="h-3.5 w-3.5 animate-[breathe_2s_ease-in-out_infinite] text-primary mr-1" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1" />
              )}
              {fetching ? t('settings.models.fetching') : t('settings.models.fetch')}
            </Button>
          </div>

          {fetchError && (
            <p className="text-xs text-destructive">{fetchError}</p>
          )}
          {fetchInfo && (
            <p className="text-xs text-muted-foreground">{fetchInfo}</p>
          )}
        </div>

        <Separator />

        {/* Section 2: Manual Add */}
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">{t('settings.models.addManual')}</h4>
            <p className="text-xs text-muted-foreground">{t('settings.models.addManual.desc')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('settings.models.modelId')}</Label>
              <Input
                placeholder={t('settings.models.modelIdPlaceholder')}
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('settings.models.alias')}</Label>
              <Input
                placeholder={t('settings.models.aliasPlaceholder')}
                value={manualAlias}
                onChange={(e) => setManualAlias(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.models.contextWindow')}</Label>
            <Input
              placeholder={t('settings.models.contextWindowPlaceholder')}
              type="number"
              value={manualContext}
              onChange={(e) => setManualContext(e.target.value)}
              className="h-8 text-sm w-48"
            />
          </div>
          <Button
            size="sm"
            onClick={handleManualAdd}
            disabled={!manualId.trim() || existingIds.has(manualId.trim())}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> {t('settings.models.add')}
          </Button>
        </div>

        <Separator />

        {/* Section 3: Existing Models */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">
            {t('settings.models.existing')} ({existingModels.length})
          </h4>
          {existingModels.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {t('settings.models.existing.empty')}
            </p>
          ) : (
            <div className="rounded-md border border-border/50 divide-y divide-border/30 max-h-80 overflow-y-auto">
              {existingModels.map((m) => (
                <div key={m.id}>
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Switch
                      checked={m.enabled !== false}
                      onCheckedChange={() => handleToggleModel(m.id)}
                      className="scale-75 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      {editingId === m.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editAlias}
                            onChange={(e) => setEditAlias(e.target.value)}
                            placeholder={m.id}
                            className="h-7 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveAlias(m.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleSaveAlias(m.id)}>
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className="cursor-pointer"
                          onClick={() => { setEditingId(m.id); setEditAlias(m.alias || ''); }}
                        >
                          <span className="font-mono text-xs truncate block">{m.alias || m.id}</span>
                          {m.alias && (
                            <span className="text-[10px] text-muted-foreground truncate block">{m.id}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {m.contextWindow && (
                        <Badge variant="outline" className="text-[10px] px-1">
                          {Math.round(m.contextWindow / 1000)}K
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => startFullEdit(m)}
                        title={t('settings.models.edit')}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteModel(m.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {fullEditId === m.id && (
                    <div className="px-3 pb-3 pt-1 space-y-3 bg-secondary/20">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{t('settings.models.editTitle')}</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFullEditId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">{t('settings.models.alias')}</Label>
                          <Input
                            value={feAlias}
                            onChange={(e) => setFeAlias(e.target.value)}
                            placeholder={m.id}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('settings.models.contextWindow')}</Label>
                          <Input
                            value={feContext}
                            onChange={(e) => setFeContext(e.target.value)}
                            placeholder={t('settings.models.contextWindowPlaceholder')}
                            type="number"
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                      <Button size="sm" onClick={handleSaveFullEdit}>
                        <Check className="h-3.5 w-3.5 mr-1" />
                        {t('settings.models.saveChanges')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
