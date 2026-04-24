'use client';

// SU-088 P0-F: extracted from (main)/settings/page.tsx to contain the
// LLM-capability probe in its own module. Also adopts useLlmCall
// (P0-G) so a network-level failure surfaces the warm taxonomy
// instead of just a silent `unknown` badge.

import { useState } from 'react';
import type { LLMProvider, ModelConfig } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Flame } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useProviderStore } from '@/lib/store/provider-store';
import { useLlmCall } from '@/lib/llm/use-llm-call';

export function CapabilityTestButton({
  capability,
  providers,
  activeModelConfig,
}: {
  capability: 'thinking' | 'vision' | 'webSearch';
  providers: LLMProvider[];
  activeModelConfig: ModelConfig;
}) {
  const t = useT();
  const { getDecryptedApiKey, setModelCapability } = useProviderStore();
  const { handleError: handleLlmError } = useLlmCall();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<'supported' | 'unsupported' | 'unknown' | null>(null);
  const [detail, setDetail] = useState('');

  const handleTest = async () => {
    const provider =
      providers.find((p) => p.id === activeModelConfig.providerId) ||
      providers.find((p) => p.isDefault) ||
      providers[0];
    if (!provider) return;

    setTesting(true);
    setResult(null);
    setDetail('');
    try {
      const apiKey = await getDecryptedApiKey(provider);
      const res = await fetch('/api/llm/test-capability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability,
          baseURL: provider.baseURL,
          apiKey,
          model: activeModelConfig.modelId || provider.models[0]?.id || '',
          apiType: provider.apiType,
          thinkingBudget: activeModelConfig.thinkingBudget ?? 1024,
        }),
      });
      const data = await res.json();
      setResult(
        data.supported === true
          ? 'supported'
          : data.supported === false
            ? 'unsupported'
            : 'unknown',
      );
      setDetail(data.detail || '');

      // SU-ITER-094 · P0-1 — persist definitive probe results so a
      // reload preserves the badge and the downstream clamp can make
      // informed decisions.  `unknown` is left unwritten to avoid
      // overwriting a previously-confirmed answer on a transient
      // failure.
      const probedModel = activeModelConfig.modelId || provider.models[0]?.id || '';
      if (probedModel && (data.supported === true || data.supported === false)) {
        try {
          await setModelCapability(provider.id, probedModel, capability, data.supported);
        } catch {
          /* non-fatal — badge still reflects this session's probe */
        }
      }
    } catch (err) {
      setResult('unknown');
      setDetail(err instanceof Error ? err.message : 'Network error');
      // Only surface a toast for true transport / classification failures;
      // `unsupported` is a legitimate product answer, not an error.
      handleLlmError(err);
    } finally {
      setTesting(false);
    }
  };

  const badge = result && (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`text-[10px] cursor-help ${
              result === 'supported'
                ? 'text-green-600 border-green-300'
                : result === 'unsupported'
                  ? 'text-destructive border-destructive/30'
                  : 'text-amber-600 border-amber-300'
            }`}
          >
            {result === 'supported' ? '✓' : result === 'unsupported' ? '✗' : '?'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs">
          {detail ||
            (result === 'supported'
              ? t('settings.capabilityResult.supported')
              : result === 'unsupported'
                ? t('settings.capabilityResult.unsupported')
                : t('settings.capabilityResult.unknown'))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div className="flex items-center gap-1.5">
      {badge}
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] px-2"
        onClick={handleTest}
        disabled={testing}
      >
        {testing ? <Flame className="h-3 w-3 animate-pulse" /> : t('settings.testCapability')}
      </Button>
    </div>
  );
}
