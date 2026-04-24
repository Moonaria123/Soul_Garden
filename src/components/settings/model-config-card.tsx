'use client';

// SU-088 P0-F: extracted from (main)/settings/page.tsx.
// Owns the active-model / temperature / thinking / vision / web-search
// configuration card (FR-402). The parent now only wires providers in
// and delegates persistence through `onConfigChange`.

import { useState } from 'react';
import type { LLMProvider, ThinkingDepth, ModelConfig } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Check, Brain, Thermometer } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { CapabilityTestButton } from './capability-test-button';

const THINKING_DEPTHS: { value: ThinkingDepth; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.thinking.off' },
  { value: 'minimal', labelKey: 'settings.thinking.minimal' },
  { value: 'low', labelKey: 'settings.thinking.low' },
  { value: 'medium', labelKey: 'settings.thinking.medium' },
  { value: 'high', labelKey: 'settings.thinking.high' },
  { value: 'xhigh', labelKey: 'settings.thinking.max' },
];

export function ModelConfigCard({
  providers,
  activeModelConfig,
  onConfigChange,
}: {
  providers: LLMProvider[];
  activeModelConfig: ModelConfig;
  onConfigChange: (updates: Partial<ModelConfig>) => Promise<void>;
}) {
  const t = useT();
  const [manualModelId, setManualModelId] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const activeProvider =
    providers.find((p) => p.id === activeModelConfig.providerId) ||
    providers.find((p) => p.isDefault) ||
    providers[0];
  const enabledModels = (activeProvider?.models || []).filter((m) => m.enabled !== false);

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="h-4 w-4" /> {t('settings.modelConfig')}
        </CardTitle>
        <CardDescription>{t('settings.modelConfig.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Provider selector */}
        {providers.length > 1 && (
          <div className="space-y-2">
            <Label>{t('settings.useProvider')}</Label>
            <Select
              value={activeModelConfig.providerId || activeProvider?.id || ''}
              onValueChange={(v) => {
                const newProvider = providers.find((p) => p.id === v);
                const newModels = (newProvider?.models || []).filter((m) => m.enabled !== false);
                onConfigChange({
                  providerId: v,
                  modelId: newModels[0]?.id || '',
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('settings.selectProvider')} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} {p.isDefault ? t('settings.defaultMark') : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Model selector with manual input fallback */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('settings.currentModel')}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowManualInput(!showManualInput)}
            >
              {showManualInput ? t('settings.selectModel') : t('settings.modelConfig.manualInput')}
            </Button>
          </div>

          {showManualInput ? (
            <div className="flex gap-2">
              <Input
                placeholder={t('settings.modelConfig.manualInputPlaceholder')}
                value={manualModelId}
                onChange={(e) => setManualModelId(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualModelId.trim()) {
                    onConfigChange({ modelId: manualModelId.trim() });
                    setManualModelId('');
                    setShowManualInput(false);
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!manualModelId.trim()}
                onClick={() => {
                  onConfigChange({ modelId: manualModelId.trim() });
                  setManualModelId('');
                  setShowManualInput(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : enabledModels.length > 0 ? (
            <Select
              value={activeModelConfig.modelId || enabledModels[0]?.id || ''}
              onValueChange={(value) => onConfigChange({ modelId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('settings.selectModel')} />
              </SelectTrigger>
              <SelectContent>
                {enabledModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.alias || model.id}
                    {model.capabilities?.vision ? ' [V]' : ''}
                    {model.capabilities?.thinking ? ' [T]' : ''}
                    {model.capabilities?.webSearch ? ' [W]' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">{t('settings.noModels')}</p>
          )}
        </div>

        <Separator />

        {/* Temperature slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5">
              <Thermometer className="h-3.5 w-3.5" /> {t('settings.temperature')}
            </Label>
            <span className="text-sm font-mono text-muted-foreground">
              {activeModelConfig.temperature.toFixed(1)}
            </span>
          </div>
          <Slider
            value={[activeModelConfig.temperature]}
            onValueChange={([value]) => onConfigChange({ temperature: value })}
            min={0}
            max={2}
            step={0.1}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">{t('settings.temperature.desc')}</p>
        </div>

        <Separator />

        {/* Thinking toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('settings.thinking')}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.thinking.enable')}</p>
            </div>
            <div className="flex items-center gap-2">
              <CapabilityTestButton
                capability="thinking"
                providers={providers}
                activeModelConfig={activeModelConfig}
              />
              <Switch
                checked={activeModelConfig.thinkingEnabled}
                onCheckedChange={(value) =>
                  onConfigChange({
                    thinkingEnabled: value,
                    thinkingDepth: value ? 'medium' : 'off',
                    thinkingBudget: value
                      ? activeModelConfig.thinkingBudget || 1024
                      : activeModelConfig.thinkingBudget,
                  })
                }
              />
            </div>
          </div>
          {activeModelConfig.thinkingEnabled && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">{t('settings.thinking.depth')}</Label>
                <Select
                  value={activeModelConfig.thinkingDepth}
                  onValueChange={(value) => onConfigChange({ thinkingDepth: value as ThinkingDepth })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THINKING_DEPTHS.filter((depth) => depth.value !== 'off').map((depth) => (
                      <SelectItem key={depth.value} value={depth.value}>
                        {t(depth.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">{t('settings.thinking.budget')}</Label>
                <Input
                  type="number"
                  min={1024}
                  step={1024}
                  className="w-40"
                  value={activeModelConfig.thinkingBudget ?? 1024}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0) onConfigChange({ thinkingBudget: v });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {t('settings.thinking.budget.desc')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Vision toggle (SU-ITER-075) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('settings.vision')}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.vision.enable')}</p>
            </div>
            <div className="flex items-center gap-2">
              <CapabilityTestButton
                capability="vision"
                providers={providers}
                activeModelConfig={activeModelConfig}
              />
              <Switch
                checked={activeModelConfig.visionEnabled ?? false}
                onCheckedChange={(value) => onConfigChange({ visionEnabled: value })}
              />
            </div>
          </div>
        </div>

        {/* Web Search toggle (SU-ITER-075) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('settings.webSearch')}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.webSearch.enable')}</p>
            </div>
            <div className="flex items-center gap-2">
              <CapabilityTestButton
                capability="webSearch"
                providers={providers}
                activeModelConfig={activeModelConfig}
              />
              <Switch
                checked={activeModelConfig.webSearchEnabled ?? false}
                onCheckedChange={(value) => onConfigChange({ webSearchEnabled: value })}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
