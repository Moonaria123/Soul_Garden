'use client';

// SU-088 P0-F: extracted from (main)/settings/page.tsx.
// Owns the add / edit form body that lives inside the provider Dialog.
// Parent still controls open/close; this component only renders
// <DialogHeader> / fields / <DialogFooter>.

import { useEffect, useState } from 'react';
import type { ApiType, LLMProvider } from '@/types';
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
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Flame } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function ProviderFormDialog({
  mode = 'add',
  initial,
  onSave,
  onCancel,
}: {
  mode?: 'add' | 'edit';
  initial?: LLMProvider;
  onSave: (opts: {
    name: string;
    baseURL: string;
    apiKey?: string;
    apiType: ApiType;
    enabled: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiType, setApiType] = useState<ApiType>('openai-compatible');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === 'edit' && initial) {
      setName(initial.name);
      setBaseURL(initial.baseURL);
      setApiKey('');
      setApiType(initial.apiType ?? 'openai-compatible');
      setEnabled(initial.enabled !== false);
    } else {
      setName('');
      setBaseURL('');
      setApiKey('');
      setApiType('openai-compatible');
      setEnabled(true);
    }
  }, [mode, initial]);

  const urlPlaceholder =
    apiType === 'openai'
      ? t('settings.form.apiUrlPlaceholder.openai')
      : apiType === 'anthropic'
        ? t('settings.form.apiUrlPlaceholder.anthropic')
        : t('settings.form.apiUrlPlaceholder.openaiCompatible');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = apiKey.trim();
    if (mode === 'add' && !trimmedKey) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        baseURL: baseURL.trim(),
        ...(mode === 'edit'
          ? trimmedKey
            ? { apiKey: trimmedKey }
            : {}
          : { apiKey: trimmedKey }),
        apiType,
        enabled,
      });
    } finally {
      setSaving(false);
    }
  };

  const isAdd = mode === 'add';
  const canSubmit = name.trim() && baseURL.trim() && (isAdd ? apiKey.trim() : true);

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{isAdd ? t('settings.addProvider') : t('settings.editProvider')}</DialogTitle>
        <DialogDescription>
          {isAdd ? t('settings.addProvider.desc') : t('settings.editProvider.desc')}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="provider-name">{t('settings.form.name')}</Label>
          <Input
            id="provider-name"
            placeholder={t('settings.form.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {/* API Type selector */}
        <div className="space-y-2">
          <Label>{t('settings.form.apiType')}</Label>
          <Select value={apiType} onValueChange={(v) => setApiType(v as ApiType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">{t('settings.form.apiType.openai')}</SelectItem>
              <SelectItem value="anthropic">{t('settings.form.apiType.anthropic')}</SelectItem>
              <SelectItem value="openai-compatible">
                {t('settings.form.apiType.openaiCompatible')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider-url">{t('settings.form.apiUrl')}</Label>
          <Input
            id="provider-url"
            placeholder={urlPlaceholder}
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="provider-key">{t('settings.form.apiKey')}</Label>
          <Input
            id="provider-key"
            type="password"
            placeholder={apiType === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required={isAdd}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {isAdd ? t('settings.form.keyNote') : t('settings.form.apiKeyKeep')}
          </p>
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label className="text-sm">{t('settings.form.enabled')}</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t('settings.form.cancel')}
        </Button>
        <Button type="submit" disabled={saving || !canSubmit}>
          {saving ? (
            <Flame className="h-4 w-4 animate-[breathe_2s_ease-in-out_infinite] text-primary mr-1" />
          ) : null}
          {t('settings.form.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
