'use client';

import { useEffect, useState } from 'react';
import type { WebSearchWhitelistCategory } from '@/types';
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
import { Plus, X, Sparkles, Eye } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function SearchWhitelistCard() {
  const t = useT();
  const {
    whitelists,
    isLoaded,
    loadConfig,
    addWhitelistUrl,
    removeWhitelistUrl,
  } = useSearchConfigStore();

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  return (
    <Card className="border-border bg-card shadow-[var(--shadow-warm-sm)]">
      <CardHeader>
        <CardTitle className="text-base font-medium font-[family-name:var(--font-display)]">
          {t('settings.searchWhitelist.title')}
        </CardTitle>
        <CardDescription>{t('settings.searchWhitelist.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <WhitelistSection
          category="fictionalSummon"
          icon={<Sparkles className="h-4 w-4 text-primary" />}
          urls={whitelists.fictionalSummon}
          onAdd={(url) => addWhitelistUrl('fictionalSummon', url)}
          onRemove={(url) => removeWhitelistUrl('fictionalSummon', url)}
        />

        <WhitelistSection
          category="worldEye"
          icon={<Eye className="h-4 w-4 text-primary" />}
          urls={whitelists.worldEye}
          onAdd={(url) => addWhitelistUrl('worldEye', url)}
          onRemove={(url) => removeWhitelistUrl('worldEye', url)}
        />
      </CardContent>
    </Card>
  );
}

function WhitelistSection({
  category,
  icon,
  urls,
  onAdd,
  onRemove,
}: {
  category: WebSearchWhitelistCategory;
  icon: React.ReactNode;
  urls: string[];
  onAdd: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  const t = useT();
  const [newUrl, setNewUrl] = useState('');

  const handleAdd = () => {
    const trimmed = newUrl.trim().replace(/\/+$/, '').replace(/^https?:\/\//, '');
    if (!trimmed) return;
    onAdd(trimmed);
    setNewUrl('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        {icon}
        <Label className="font-medium">
          {t(`settings.searchWhitelist.${category}.title`)}
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`settings.searchWhitelist.${category}.desc`)}
      </p>

      {/* URL tags */}
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {urls.map((url) => (
            <Badge
              key={url}
              variant="secondary"
              className="pl-2 pr-1 py-0.5 text-xs gap-1"
            >
              <span className="max-w-[200px] truncate">{url}</span>
              <button
                type="button"
                onClick={() => onRemove(url)}
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {urls.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic">
          {t('settings.searchWhitelist.emptyHint')}
        </p>
      )}

      {/* Add URL input */}
      <div className="flex gap-2">
        <Input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('settings.searchWhitelist.addPlaceholder')}
          className="bg-[hsl(var(--su-surface-2))] text-sm h-8"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!newUrl.trim()}
          className="h-8"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
