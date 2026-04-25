'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import {
  useEmbeddingConfigStore,
  type EmbeddingMode,
} from '@/lib/store/embedding-config-store';
import {
  LOCAL_EMBEDDING_MODEL_CATALOG,
  type LocalEmbeddingModelOption,
  type LocalWeightSource,
} from '@/lib/memory/embedding-constants';
import { downloadLocalEmbeddingModel, resetLocalEmbeddingPipelineCache } from '@/lib/memory/embedding-local';
import { probeEmbeddingDims } from '@/lib/memory/embedding-cloud';
import {
  reindexAllMemoryEmbeddings,
  deleteAllMemoryEmbeddingsGlobally,
} from '@/lib/memory/memory-embedding-reindex';
import { Loader2, Sparkles } from 'lucide-react';

export function EmbeddingSettingsCard() {
  const t = useT();
  const {
    settings,
    isLoaded,
    loadConfig,
    setMode,
    setLocalStatus,
    setLocalModelId,
    setLocalWeightSource,
    setCloudConfig,
    getDecryptedCloudApiKey,
    persist,
  } = useEmbeddingConfigStore();

  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudModel, setCloudModel] = useState('');
  const [cloudKey, setCloudKey] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [reindexPercent, setReindexPercent] = useState<{
    percent: number;
    current: number;
    total: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const currentLocalMeta: LocalEmbeddingModelOption | undefined = LOCAL_EMBEDDING_MODEL_CATALOG.find(
    (x) => x.id === settings.local.modelId,
  );

  useEffect(() => {
    if (!isLoaded) {
      void loadConfig();
    }
  }, [isLoaded, loadConfig]);

  useEffect(() => {
    setCloudUrl(settings.cloud.baseURL);
    setCloudModel(settings.cloud.modelId);
  }, [settings.cloud.baseURL, settings.cloud.modelId]);

  const onModeChange = async (mode: EmbeddingMode) => {
    try {
      if (mode === 'local' && settings.local.status !== 'ready') {
        toast.message(t('settings.embedding.localNeedDownload'));
        return;
      }
      if (mode === 'cloud') {
        const key = cloudKey.trim() || (await getDecryptedCloudApiKey());
        if (!settings.cloud.baseURL?.trim() && !cloudUrl.trim()) {
          toast.error(t('settings.embedding.cloudNeedUrl'));
          return;
        }
        if (!key) {
          toast.error(t('settings.embedding.cloudNeedKey'));
          return;
        }
      }
      await setMode(mode);
      toast.success(t('settings.embedding.modeSaved'));
    } catch (e) {
      toast.error(t('settings.embedding.saveFailed'));
      console.error(e);
    }
  };

  const handleDownloadLocal = async () => {
    setBusy(true);
    setDownloadProgress(0);
    try {
      await downloadLocalEmbeddingModel(
        settings.local.modelId,
        (state) => {
          const p = state.progress;
          if (typeof p === 'number') setDownloadProgress(Math.round(p * 100));
        },
        settings.local.weightSource,
      );
      await setLocalStatus('ready');
      await setMode('local');
      toast.success(t('settings.embedding.localReady'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setLocalStatus('error', msg);
      toast.error(t('settings.embedding.localFailed'));
    } finally {
      setBusy(false);
      setDownloadProgress(null);
    }
  };

  const handleClearLocalCache = async () => {
    resetLocalEmbeddingPipelineCache();
    await persist({
      ...settings,
      mode: 'off',
      activeModelKey: '',
      local: { ...settings.local, status: 'not_downloaded', lastError: undefined },
    });
    toast.message(t('settings.embedding.localCacheCleared'));
  };

  const handleSaveCloud = async () => {
    setBusy(true);
    try {
      await setCloudConfig({
        baseURL: cloudUrl,
        modelId: cloudModel || 'text-embedding-3-small',
        apiKey: cloudKey.trim() || undefined,
      });
      setCloudKey('');
      toast.success(t('settings.embedding.cloudSaved'));
    } catch {
      toast.error(t('settings.embedding.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleTestCloud = async () => {
    setBusy(true);
    try {
      const key = cloudKey.trim() || (await getDecryptedCloudApiKey());
      if (!cloudUrl.trim() || !key) {
        toast.error(t('settings.embedding.cloudTestNeed'));
        return;
      }
      const dims = await probeEmbeddingDims({
        baseURL: cloudUrl,
        apiKey: key,
        model: cloudModel || 'text-embedding-3-small',
        input: 'ping',
      });
      await setCloudConfig({
        baseURL: cloudUrl,
        modelId: cloudModel || 'text-embedding-3-small',
        dims,
      });
      toast.success(t('settings.embedding.cloudTestOk', { dims: String(dims) }));
    } catch (e) {
      toast.error(t('settings.embedding.cloudTestFail'));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const handleReindex = async () => {
    setBusy(true);
    setReindexPercent({ percent: 0, current: 0, total: 0 });
    try {
      const r = await reindexAllMemoryEmbeddings(undefined, (p) => {
        setReindexPercent(p);
      });
      if (r.embeddingOff) {
        toast.message(t('settings.embedding.reindexNeedEmbedding'));
        return;
      }
      if (r.totalSources === 0) {
        toast.message(t('settings.embedding.reindexNoMemories'));
        return;
      }
      toast.success(
        t('settings.embedding.reindexDone', {
          n: String(r.written),
          m: String(r.totalSources),
        }),
      );
      if (r.entitiesSkipped > 0) {
        toast.message(
          t('settings.embedding.reindexSkippedEntities', { k: String(r.entitiesSkipped) }),
        );
      }
    } catch (e) {
      toast.error(t('settings.embedding.reindexFail'));
      console.error(e);
    } finally {
      setBusy(false);
      setReindexPercent(null);
    }
  };

  const handleDeleteVectors = async () => {
    setBusy(true);
    try {
      await deleteAllMemoryEmbeddingsGlobally();
      toast.success(t('settings.embedding.vectorsCleared'));
    } catch (e) {
      toast.error(t('settings.embedding.deleteFail'));
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!isLoaded) {
    return (
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardContent className="py-8 flex justify-center text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {t('settings.loading')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2 font-[family-name:var(--font-display)]">
          <Sparkles className="h-4 w-4 text-primary/80" />
          {t('settings.embedding.title')}
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          {t('settings.embedding.desc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>{t('settings.embedding.mode')}</Label>
          <Select
            value={settings.mode}
            onValueChange={(v) => void onModeChange(v as EmbeddingMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('settings.embedding.modeOff')}</SelectItem>
              <SelectItem value="local">{t('settings.embedding.modeLocal')}</SelectItem>
              <SelectItem value="cloud">{t('settings.embedding.modeCloud')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border border-border/50 bg-background/40 p-4 space-y-3">
          <p className="text-sm font-medium">{t('settings.embedding.localSection')}</p>
          <div className="space-y-2">
            <Label htmlFor="emb-weight-source-switch">{t('settings.embedding.weightSource')}</Label>
            <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
              <span
                className={`text-sm flex-1 min-w-0 ${settings.local.weightSource === 'huggingface' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
              >
                {t('settings.embedding.weightSourceToggleOfficial')}
              </span>
              <Switch
                id="emb-weight-source-switch"
                checked={settings.local.weightSource === 'hfMirror'}
                disabled={busy}
                onCheckedChange={(useMirror) => {
                  const src: LocalWeightSource = useMirror ? 'hfMirror' : 'huggingface';
                  resetLocalEmbeddingPipelineCache();
                  if (
                    src !== settings.local.weightSource &&
                    settings.mode === 'local' &&
                    settings.local.status === 'ready'
                  ) {
                    toast.message(t('settings.embedding.localWeightSourceSwitched'));
                  }
                  void setLocalWeightSource(src);
                }}
                aria-label={t('settings.embedding.weightSourceToggleAria')}
              />
              <span
                className={`text-sm flex-1 min-w-0 text-right ${settings.local.weightSource === 'hfMirror' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
              >
                {t('settings.embedding.weightSourceToggleMirror')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('settings.embedding.weightSourceHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t('settings.embedding.localPick')}</Label>
            <Select
              value={settings.local.modelId}
              disabled={busy}
              onValueChange={(id) => {
                resetLocalEmbeddingPipelineCache();
                if (
                  id !== settings.local.modelId &&
                  settings.mode === 'local' &&
                  settings.local.status === 'ready'
                ) {
                  toast.message(t('settings.embedding.localModelSwitched'));
                }
                void setLocalModelId(id);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCAL_EMBEDDING_MODEL_CATALOG.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {t(`settings.embedding.localModel.${m.slug}.name`)} ({m.sizeTier})
                    {m.zhOptimized ? ` · ${t('settings.embedding.zhTag')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(`settings.embedding.localModel.${currentLocalMeta?.slug ?? 'e5Small'}.desc`)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('settings.embedding.localPickHint')}
          </p>
          {settings.local.status === 'ready' ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('settings.embedding.localStatusReady')}</p>
          ) : settings.local.status === 'error' ? (
            <p className="text-xs text-destructive/90 whitespace-pre-wrap">{settings.local.lastError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('settings.embedding.localStatusNone')}</p>
          )}
          {downloadProgress !== null && (
            <p className="text-xs text-muted-foreground">{t('settings.embedding.downloadProgress', { p: String(downloadProgress) })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void handleDownloadLocal()}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {t('settings.embedding.downloadLocal')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleClearLocalCache()}>
              {t('settings.embedding.clearLocalCache')}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-background/40 p-4 space-y-3">
          <p className="text-sm font-medium">{t('settings.embedding.cloudSection')}</p>
          <div className="space-y-2">
            <Label htmlFor="emb-cloud-url">{t('settings.embedding.cloudUrl')}</Label>
            <Input
              id="emb-cloud-url"
              value={cloudUrl}
              onChange={(e) => setCloudUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emb-cloud-model">{t('settings.embedding.cloudModel')}</Label>
            <Input
              id="emb-cloud-model"
              value={cloudModel}
              onChange={(e) => setCloudModel(e.target.value)}
              placeholder="text-embedding-3-small"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emb-cloud-key">{t('settings.embedding.cloudKey')}</Label>
            <Input
              id="emb-cloud-key"
              type="password"
              value={cloudKey}
              onChange={(e) => setCloudKey(e.target.value)}
              placeholder={t('settings.embedding.cloudKeyPlaceholder')}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void handleSaveCloud()}>
              {t('settings.embedding.saveCloud')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleTestCloud()}>
              {t('settings.embedding.testCloud')}
            </Button>
          </div>
          {typeof settings.cloud.dims === 'number' ? (
            <p className="text-xs text-muted-foreground">{t('settings.embedding.dims', { n: String(settings.cloud.dims) })}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border/50 bg-background/40 p-4 space-y-3">
          <p className="text-sm font-medium">{t('settings.embedding.maintenance')}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{t('settings.embedding.maintenanceHint')}</p>
          {reindexPercent !== null && reindexPercent.total > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t('settings.embedding.reindexPercent', {
                  p: String(reindexPercent.percent),
                  c: String(reindexPercent.current),
                  t: String(reindexPercent.total),
                })}
              </p>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden max-w-sm">
                <div
                  className="h-full bg-primary/80 transition-[width] duration-200 ease-out"
                  style={{ width: `${reindexPercent.percent}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void handleReindex()}>
              {busy && reindexPercent ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {t('settings.embedding.reindex')}
            </Button>
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void handleDeleteVectors()}>
              {t('settings.embedding.deleteVectors')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
