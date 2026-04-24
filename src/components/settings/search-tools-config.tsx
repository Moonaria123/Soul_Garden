'use client';

import { useEffect, useState } from 'react';
import type { ActiveSearchTool, SearchToolType } from '@/types';
import { useSearchConfigStore } from '@/lib/store/search-config-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Check, Loader2, Globe, Zap, Flame, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';

export function SearchToolsConfigCard() {
  const t = useT();
  const {
    activeTool,
    toolConfigs,
    isLoaded,
    loadConfig,
    setActiveTool,
    addToolConfig,
    updateToolConfig,
    getDecryptedApiKey,
    maxToolIterations,
    setMaxToolIterations,
  } = useSearchConfigStore();

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  const braveConfig = toolConfigs.find((c) => c.type === 'brave');
  const firecrawlConfig = toolConfigs.find((c) => c.type === 'firecrawl');

  const tools: {
    id: ActiveSearchTool;
    icon: React.ReactNode;
    available: boolean;
  }[] = [
    {
      id: 'llm-native',
      icon: <Zap className="h-4 w-4" />,
      available: true,
    },
    {
      id: 'brave',
      icon: <Globe className="h-4 w-4" />,
      available: !!braveConfig,
    },
    {
      id: 'firecrawl',
      icon: <Flame className="h-4 w-4" />,
      available: !!firecrawlConfig,
    },
  ];

  return (
    <Card className="border-border bg-card shadow-[var(--shadow-warm-sm)]">
      <CardHeader>
        <CardTitle className="text-base font-medium font-[family-name:var(--font-display)]">
          {t('settings.searchTools.title')}
        </CardTitle>
        <CardDescription>{t('settings.searchTools.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Active tool selector */}
        <div className="space-y-3">
          <Label className="text-sm">{t('settings.searchTools.activeLabel')}</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                disabled={!tool.available}
                onClick={() => setActiveTool(tool.id)}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all ${
                  activeTool === tool.id
                    ? 'border-primary bg-[hsl(var(--su-primary-highlight))] text-foreground'
                    : tool.available
                      ? 'border-border bg-card text-muted-foreground hover:border-primary/50'
                      : 'cursor-not-allowed border-border/50 bg-muted/30 text-muted-foreground/50'
                }`}
              >
                {tool.icon}
                <span className="font-medium">{t(`settings.searchTools.tool.${tool.id}`)}</span>
                {activeTool === tool.id && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
          {activeTool === 'llm-native' && (
            <p className="text-xs text-muted-foreground">
              {/* SU-ITER-096 · Bug B-3 hint — tells the user which model
                  families actually honour the llm-native path so they
                  don't assume it works on every model. */}
              {t('settings.searchTools.llmNativeHint')}
            </p>
          )}
          {!braveConfig && !firecrawlConfig && (
            <p className="text-xs text-muted-foreground">
              {t('settings.searchTools.configHint')}
            </p>
          )}
        </div>

        {/* SU-ITER-094 · Phase-B — max tool-calling iterations.  Caps how
            many web_search / fetch_url round-trips a single chat turn
            may trigger when an external search tool is selected.  Range
            1–10; default 3 (see FC#2). */}
        <div className="space-y-2">
          <Label className="text-sm" htmlFor="maxToolIterations">
            {t('settings.searchTools.maxIterationsLabel')}
          </Label>
          <div className="flex items-center gap-3">
            <Input
              id="maxToolIterations"
              type="number"
              min={1}
              max={10}
              step={1}
              value={maxToolIterations}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMaxToolIterations(v);
              }}
              className="w-24 bg-[hsl(var(--su-surface-2))]"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.searchTools.maxIterationsHint')}
            </p>
          </div>
        </div>

        {/* Brave Search Config */}
        <SearchToolApiConfig
          type="brave"
          config={braveConfig}
          onSave={async (apiKey) => {
            if (braveConfig) {
              await updateToolConfig(braveConfig.id, { apiKey });
            } else {
              await addToolConfig({ type: 'brave', name: 'Brave Search', apiKey });
            }
          }}
          onGetKey={braveConfig ? () => getDecryptedApiKey(braveConfig) : undefined}
        />

        {/* Firecrawl Config */}
        <SearchToolApiConfig
          type="firecrawl"
          config={firecrawlConfig}
          showBaseUrl
          onSave={async (apiKey, baseURL) => {
            if (firecrawlConfig) {
              await updateToolConfig(firecrawlConfig.id, { apiKey, baseURL });
            } else {
              await addToolConfig({ type: 'firecrawl', name: 'Firecrawl', apiKey, baseURL });
            }
          }}
          onGetKey={firecrawlConfig ? () => getDecryptedApiKey(firecrawlConfig) : undefined}
        />

        <p className="text-xs text-muted-foreground/70">
          {t('settings.searchTools.privacyNote')}
        </p>
      </CardContent>
    </Card>
  );
}

function SearchToolApiConfig({
  type,
  config,
  showBaseUrl = false,
  onSave,
  onGetKey,
}: {
  type: SearchToolType;
  config?: { id: string; baseURL?: string };
  showBaseUrl?: boolean;
  onSave: (apiKey: string, baseURL?: string) => Promise<void>;
  onGetKey?: () => Promise<string>;
}) {
  const t = useT();
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    if (config?.baseURL) setBaseURL(config.baseURL);
  }, [config?.baseURL]);

  const handleTest = async () => {
    const key = apiKey || (onGetKey ? await onGetKey() : '');
    if (!key) {
      toast.error(t('settings.searchTools.noKeyError'));
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/search/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          apiKey: key,
          baseUrl: showBaseUrl ? baseURL || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult('success');
        toast.success(t('settings.searchTools.testSuccess'));
      } else {
        setTestResult('error');
        toast.error(data.error || t('settings.searchTools.testFailed'));
      }
    } catch {
      setTestResult('error');
      toast.error(t('settings.searchTools.testFailed'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey && !config) {
      toast.error(t('settings.searchTools.noKeyError'));
      return;
    }
    setSaving(true);
    try {
      await onSave(apiKey || '', showBaseUrl ? baseURL || undefined : undefined);
      setApiKey('');
      toast.success(t('settings.searchTools.saved'));
    } catch {
      toast.error(t('settings.searchTools.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const label = type === 'brave' ? 'Brave Search' : 'Firecrawl';

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <Label className="font-medium">{label}</Label>
        {config && (
          <Badge variant="outline" className="text-xs">
            {t('settings.searchTools.configured')}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">API Key</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder={config ? t('settings.searchTools.keyPlaceholderExisting') : t('settings.searchTools.keyPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] pr-8"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {showBaseUrl && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Base URL</Label>
          <Input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://api.firecrawl.dev"
            className="bg-[hsl(var(--su-surface-2))]"
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : testResult === 'success' ? (
            <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
          ) : testResult === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 mr-1 text-destructive" />
          ) : null}
          {t('settings.searchTools.testBtn')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || (!apiKey && !config)}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          {t('settings.searchTools.saveBtn')}
        </Button>
      </div>
    </div>
  );
}
