'use client';

import { useState } from 'react';
import type { TextMaterial } from '@/types';
import { useSearchConfigStore } from '@/lib/store/search-config-store';
import { useProviderStore } from '@/lib/store/provider-store';
import { executeDimensionalBreak } from '@/lib/search/dimensional-break-service';
import {
  dimensionalBreakToTextMaterial,
  dimensionLabel,
  type DimensionalBreakResult,
  type DimensionKey,
} from '@/lib/search/search-types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Sparkles, Loader2, RefreshCw, ChevronDown, ExternalLink, ShieldCheck } from 'lucide-react';
import { WorkflowProgress, type WorkflowStep } from '@/components/ui/workflow-progress';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useLlmCall } from '@/lib/llm/use-llm-call';
import type { DimBreakStepId, StepStatus } from '@/lib/search/dimensional-break-service';
import { DIMBREAK_STEPS_LLM, DIMBREAK_STEPS_EXTERNAL } from '@/lib/search/dimensional-break-service';

interface DimensionalBreakStepProps {
  characterName: string;
  workName: string;
  webSearchMaterials: TextMaterial[];
  onMaterialsChange: (materials: TextMaterial[]) => void;
}

export function DimensionalBreakStep({
  characterName,
  workName,
  webSearchMaterials,
  onMaterialsChange,
}: DimensionalBreakStepProps) {
  const t = useT();
  const { handleError: handleLlmError } = useLlmCall();
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<string | undefined>();
  const [result, setResult] = useState<DimensionalBreakResult | null>(null);
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set());
  const [wfSteps, setWfSteps] = useState<WorkflowStep[]>([]);

  const hasResults = result !== null || webSearchMaterials.length > 0;

  const toggleDim = (key: string) => {
    setExpandedDims((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dimStepLabel = (id: DimBreakStepId): string => {
    const labels: Record<DimBreakStepId, string> = {
      invoke_llm: t('workflow.step.invokeLLM'),
      parse_dimensions: t('workflow.step.parseDimensions'),
      build_queries: t('workflow.step.buildQueries'),
      execute_search: t('workflow.step.executeSearch'),
      deduplicate: t('workflow.step.deduplicate'),
      llm_synthesis: t('workflow.step.llmSynthesis'),
    };
    return labels[id];
  };

  const handleExecute = async () => {
    setIsSearching(true);
    setProgress(undefined);
    setResult(null);

    try {
      const searchConfig = useSearchConfigStore.getState();
      const isLLMNative = searchConfig.activeTool === 'llm-native';
      const stepIds = isLLMNative ? DIMBREAK_STEPS_LLM : DIMBREAK_STEPS_EXTERNAL;
      const initialSteps: WorkflowStep[] = stepIds.map((id) => ({
        id, label: dimStepLabel(id), status: 'pending' as const,
      }));
      setWfSteps(initialSteps);

      const handleStepChange = (stepId: DimBreakStepId, status: StepStatus) => {
        setWfSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, status } : s));
      };

      const llmOpts = await useProviderStore.getState().getActiveLLMOptions();
      if (!llmOpts) {
        toast.error(t('new.dimensionalBreak.noLLMError'));
        return;
      }

      let decryptedApiKey: string | undefined;
      const activeConfig = searchConfig.toolConfigs.find(
        (c) => c.type === searchConfig.activeTool
      );
      if (activeConfig && searchConfig.activeTool !== 'llm-native') {
        decryptedApiKey = await searchConfig.getDecryptedApiKey(activeConfig);
      }

      const breakResult = await executeDimensionalBreak({
        characterName,
        workName,
        activeTool: searchConfig.activeTool,
        toolConfig: activeConfig,
        decryptedApiKey,
        whitelist: searchConfig.whitelists.fictionalSummon,
        llmOptions: llmOpts,
        onProgress: setProgress,
        onStepChange: handleStepChange,
      });

      setResult(breakResult);

      const material = dimensionalBreakToTextMaterial(breakResult, characterName, workName);
      onMaterialsChange([material]);

      setExpandedDims(new Set(breakResult.dimensions.slice(0, 3).map((d) => d.key)));
    } catch (err) {
      // SU-088 P0-G: route LLM / network failures through the
      // classified toast. Non-LLM errors (e.g. search-provider API
      // key missing, thrown as plain Error) still fall through to
      // the `upstream` bucket with their message preserved as detail.
      handleLlmError(err, { onRetry: handleExecute });
    } finally {
      setIsSearching(false);
      setProgress(undefined);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-lg font-medium font-[family-name:var(--font-display)]">
          {t('new.dimensionalBreak.title')}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t('new.dimensionalBreak.subtitle')}
        </p>
      </div>

      {/* Character info display */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-[hsl(var(--su-surface-2))] p-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{characterName || '—'}</p>
          <p className="text-xs text-muted-foreground truncate">
            {workName || t('new.dimensionalBreak.unknownWork')}
          </p>
        </div>
        <Badge variant="outline" className="text-xs shrink-0">
          {t('new.dimensionalBreak.fromQuestionnaire')}
        </Badge>
      </div>

      {/* Execute / loading state */}
      {!hasResults && !isSearching && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Button
            type="button"
            onClick={handleExecute}
            className="gap-2 shadow-[var(--shadow-warm-sm)]"
          >
            <Sparkles className="h-4 w-4" />
            {t('new.dimensionalBreak.executeBtn')}
          </Button>
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            {t('new.dimensionalBreak.executeHint')}
          </p>
        </div>
      )}

      {isSearching && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="relative">
            <Sparkles className="h-8 w-8 text-primary animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">
            {progress || t('new.dimensionalBreak.searching')}
          </p>
          <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
          {wfSteps.length > 0 && (
            <WorkflowProgress steps={wfSteps} />
          )}
        </div>
      )}

      {/* Results */}
      {result && result.dimensions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t('new.dimensionalBreak.resultsTitle')}
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleExecute}
              disabled={isSearching}
              className="text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t('new.dimensionalBreak.retry')}
            </Button>
          </div>

          <div className="space-y-2">
            {result.dimensions.map((dim) => (
              <Collapsible
                key={dim.key}
                open={expandedDims.has(dim.key)}
                onOpenChange={() => toggleDim(dim.key)}
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-secondary/30 transition-colors">
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                      expandedDims.has(dim.key) ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                  <span className="text-sm font-medium flex-1 truncate">
                    {dimensionLabel(dim.key as DimensionKey)}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-3">
                  <div className="mt-2 rounded-md bg-[hsl(var(--su-surface-2))] p-3 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                    {dim.content}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>

          {/* Sources */}
          {result.sources.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t('new.dimensionalBreak.sources')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.sources.slice(0, 10).map((source, i) => (
                  <a
                    key={i}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {source.title.slice(0, 30) || new URL(source.url).hostname}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Privacy notice */}
      <div className="flex items-start gap-2 rounded-lg bg-secondary/30 p-3">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          {t('new.dimensionalBreak.privacyNote')}
        </p>
      </div>
    </div>
  );
}
