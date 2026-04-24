'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import type { ConsciousnessEntity, SoulDocKeyV1, ExtractionStep, TextMaterial } from '@/types';
import { SOUL_DOC_KEYS_V1, EXTRACTION_STEPS } from '@/types';
import { useEntityStore } from '@/lib/store/entity-store';
import { useProviderStore } from '@/lib/store/provider-store';
import { extractSoul, enrichSoul } from '@/lib/agents/soul-extraction';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, MessageCircle, Download, Trash2, Flame, BookOpen, X, Archive, Sparkles, HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { WorkflowProgress, type WorkflowStep } from '@/components/ui/workflow-progress';
import Link from 'next/link';
import { DeleteEntityDialog } from '@/components/entity/delete-entity-dialog';
import { ExportDialog } from '@/components/export/export-dialog';
import { OpenClawDialog } from '@/components/export/openclaw-dialog';
import { SoulDocViewer } from '@/components/markdown/soul-doc-viewer';
import { AvatarUpload } from '@/components/entity/avatar-upload';
import { DocumentUpload } from '@/components/materials/document-upload';
import { ChatRecordUpload } from '@/components/materials/chat-record-upload';
import { useT } from '@/lib/i18n';
import { useLlmCall } from '@/lib/llm/use-llm-call';
import { BackupEntityDialog } from '@/components/backup/backup-entity-dialog';
import { RestoreEntityDialog } from '@/components/backup/restore-entity-dialog';

export default function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const t = useT();
  const { handleError: handleLlmError } = useLlmCall();
  const { getEntity, updateEntity, deleteEntity } = useEntityStore();
  const { loadProviders, getActiveLLMOptions } = useProviderStore();

  const [entity, setEntity] = useState<ConsciousnessEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [currentExtractionStep, setCurrentExtractionStep] = useState<ExtractionStep | null>(null);
  const [narrativeIdx, setNarrativeIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<string>('SOUL');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showMemorySanctuary, setShowMemorySanctuary] = useState(false);
  const [showOpenClawDialog, setShowOpenClawDialog] = useState(false);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const narrativeTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const soulDocLabelKeys: Record<SoulDocKeyV1, string> = {
    SOUL: 'soulDoc.SOUL',
    VOICE: 'soulDoc.VOICE',
    EMOTIONAL_PATTERNS: 'soulDoc.EMOTIONAL_PATTERNS',
    MEMORY: 'soulDoc.MEMORY',
    RELATIONSHIP: 'soulDoc.RELATIONSHIP',
  };

  useEffect(() => {
    loadProviders();
    getEntity(id).then((e) => {
      setEntity(e || null);
      setLoading(false);
    });
  }, [id, getEntity, loadProviders]);

  // Rotate narrative sub-messages during extraction (SU-ITER-037)
  useEffect(() => {
    if (!extracting || !currentExtractionStep || currentExtractionStep === 'complete') {
      clearInterval(narrativeTimer.current);
      return;
    }
    setNarrativeIdx(0);
    narrativeTimer.current = setInterval(() => {
      setNarrativeIdx((prev) => prev + 1);
    }, 4000);
    return () => clearInterval(narrativeTimer.current);
  }, [extracting, currentExtractionStep]);

  const getNarrativeMessage = useCallback(() => {
    if (!currentExtractionStep || currentExtractionStep === 'complete') return '';
    const key = `extraction.narrative.${currentExtractionStep}.${narrativeIdx % 3}`;
    return t(key);
  }, [currentExtractionStep, narrativeIdx, t]);

  // Stale extraction recovery (SU-ITER-038)
  useEffect(() => {
    if (!entity || entity.status !== 'extracting' || extracting) return;
    void (async () => {
      await updateEntity(entity.id, { status: 'draft', errorMessage: undefined });
      setEntity((prev) => (prev ? { ...prev, status: 'draft' } : null));
      try {
        const key = `soul_stale_recovery_toast_${entity.id}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          toast.info(t('entity.detail.extractionStale'));
        }
      } catch {
        toast.info(t('entity.detail.extractionStale'));
      }
    })();
  }, [entity?.id, entity?.status, extracting, updateEntity, t]);

  const startExtraction = useCallback(async () => {
    if (!entity) return;

    const llmOptions = await getActiveLLMOptions();
    if (!llmOptions) {
      toast.error(t('settings.noModels'));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setExtracting(true);
    setProgress(0);
    setCurrentExtractionStep(null);
    await updateEntity(entity.id, { status: 'extracting' });
    setEntity((prev) => (prev ? { ...prev, status: 'extracting' } : prev));

    await extractSoul(
      entity.questionnaire,
      {
        apiKey: llmOptions.apiKey,
        baseURL: llmOptions.baseURL,
        model: llmOptions.model,
        temperature: llmOptions.temperature,
        apiType: llmOptions.apiType,
      },
      {
        onProgress: (step, message, pct) => {
          setProgress(pct);
          setCurrentExtractionStep(step);
          setProgressMessage(t(`extraction.${step}`) || message);
        },
        onDocGenerated: async (key, content) => {
          const updatedDocs = { ...entity.soulDocs, [key]: content };
          await updateEntity(entity.id, { soulDocs: updatedDocs });
          setEntity((prev) => prev ? { ...prev, soulDocs: updatedDocs } : prev);
        },
        onComplete: async (docs) => {
          await updateEntity(entity.id, { soulDocs: docs, status: 'ready' });
          setEntity((prev) => prev ? { ...prev, soulDocs: docs, status: 'ready' } : prev);
          setExtracting(false);
          setProgress(100);
          setCurrentExtractionStep('complete');
          setProgressMessage(t('extraction.complete'));
          toast.success(t('entity.detail.awake', { name: entity.name }));
          abortRef.current = null;
        },
        onError: async (step, error) => {
          await updateEntity(entity.id, {
            status: 'error',
            errorMessage: error.message,
          });
          setEntity((prev) =>
            prev ? { ...prev, status: 'error', errorMessage: error.message } : prev
          );
          // SU-088 P0-G: classify the LLM failure and show the warm
          // copy alongside the persistent errorMessage surface, so
          // users see the category (network / auth / rate_limit / …)
          // immediately without having to scroll to the status card.
          handleLlmError(error);
          setExtracting(false);
          abortRef.current = null;
        },
        onCancelled: async () => {
          await updateEntity(entity.id, { status: 'draft' });
          setEntity((prev) => prev ? { ...prev, status: 'draft' } : prev);
          setExtracting(false);
          setProgress(0);
          setCurrentExtractionStep(null);
          toast.info(t('extraction.cancelled'));
          abortRef.current = null;
        },
      },
      controller.signal,
      [...(entity.textMaterials ?? []), ...(entity.chatMaterials ?? [])],
      entity.webSearchMaterials
    );
  }, [entity, getActiveLLMOptions, updateEntity, t, handleLlmError]);

  const startEnrichment = useCallback(async () => {
    const allMaterials = [...(entity?.textMaterials ?? []), ...(entity?.chatMaterials ?? [])];
    if (!entity || allMaterials.length === 0) return;
    if (!entity.soulDocs.SOUL) {
      toast.error(t('entity.detail.noSoulToEnrich'));
      return;
    }

    const llmOptions = await getActiveLLMOptions();
    if (!llmOptions) {
      toast.error(t('settings.noModels'));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setExtracting(true);
    setProgress(0);
    setCurrentExtractionStep(null);
    await updateEntity(entity.id, { status: 'extracting' });
    setEntity((prev) => (prev ? { ...prev, status: 'extracting' } : prev));

    const allEnrichMaterials = [...(entity.textMaterials ?? []), ...(entity.chatMaterials ?? [])];
    await enrichSoul(
      entity.soulDocs,
      entity.questionnaire,
      allEnrichMaterials,
      {
        apiKey: llmOptions.apiKey,
        baseURL: llmOptions.baseURL,
        model: llmOptions.model,
        temperature: llmOptions.temperature,
        apiType: llmOptions.apiType,
      },
      {
        onProgress: (step, message, pct) => {
          setProgress(pct);
          setCurrentExtractionStep(step);
          setProgressMessage(t(`enrichment.${step}`) || t(`extraction.${step}`) || message);
        },
        onDocGenerated: async (key, content) => {
          const updatedDocs = { ...entity.soulDocs, [key]: content };
          await updateEntity(entity.id, { soulDocs: updatedDocs });
          setEntity((prev) => prev ? { ...prev, soulDocs: updatedDocs } : prev);
        },
        onComplete: async (docs) => {
          await updateEntity(entity.id, { soulDocs: docs, status: 'ready' });
          setEntity((prev) => prev ? { ...prev, soulDocs: docs, status: 'ready' } : prev);
          setExtracting(false);
          setProgress(100);
          setCurrentExtractionStep('complete');
          setProgressMessage(t('enrichment.complete'));
          toast.success(t('enrichment.success', { name: entity.name }));
          abortRef.current = null;
        },
        onError: async (step, error) => {
          await updateEntity(entity.id, {
            status: 'ready',
            errorMessage: error.message,
          });
          setEntity((prev) =>
            prev ? { ...prev, status: 'ready', errorMessage: error.message } : prev
          );
          setExtracting(false);
          // SU-088 P0-G: classify the LLM failure so the user sees a
          // warm, category-aware toast instead of the generic
          // `enrichment.error` copy.
          handleLlmError(error, {
            description: t('enrichment.error'),
          });
          abortRef.current = null;
        },
        onCancelled: async () => {
          await updateEntity(entity.id, { status: 'ready' });
          setEntity((prev) => prev ? { ...prev, status: 'ready' } : prev);
          setExtracting(false);
          setProgress(0);
          setCurrentExtractionStep(null);
          toast.info(t('extraction.cancelled'));
          abortRef.current = null;
        },
      },
      controller.signal
    );
  }, [entity, getActiveLLMOptions, updateEntity, t, handleLlmError]);

  const cancelExtraction = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  const handleDelete = async () => {
    if (!entity) return;
    await deleteEntity(entity.id);
    router.push('/home');
  };

  const handleDocSave = useCallback(async (key: SoulDocKeyV1, content: string) => {
    if (!entity) return;
    const updatedDocs = { ...entity.soulDocs, [key]: content };
    await updateEntity(entity.id, { soulDocs: updatedDocs });
    setEntity((prev) => prev ? { ...prev, soulDocs: updatedDocs } : prev);
    toast.success(t('entity.detail.docSaved'));
  }, [entity, t, updateEntity]);

  const handleAvatarUpload = useCallback(async (dataUrl: string) => {
    if (!entity) return;
    await updateEntity(entity.id, { avatarUrl: dataUrl });
    setEntity((prev) => prev ? { ...prev, avatarUrl: dataUrl } : prev);
  }, [entity, updateEntity]);

  const handleAvatarRemove = useCallback(async () => {
    if (!entity) return;
    await updateEntity(entity.id, { avatarUrl: undefined });
    setEntity((prev) => prev ? { ...prev, avatarUrl: undefined } : prev);
  }, [entity, updateEntity]);

  const handleMaterialsChange = useCallback(async (materials: TextMaterial[]) => {
    if (!entity) return;
    await updateEntity(entity.id, { textMaterials: materials });
    setEntity((prev) => prev ? { ...prev, textMaterials: materials } : prev);
    toast.success(t('entity.detail.materialsUpdated'));
  }, [entity, t, updateEntity]);

  const handleChatMaterialsChange = useCallback(async (materials: TextMaterial[]) => {
    if (!entity) return;
    await updateEntity(entity.id, { chatMaterials: materials });
    setEntity((prev) => prev ? { ...prev, chatMaterials: materials } : prev);
    toast.success(t('entity.detail.materialsUpdated'));
  }, [entity, t, updateEntity]);

  const extractionWorkflowSteps: WorkflowStep[] = useMemo(() => {
    const currentIdx = currentExtractionStep
      ? EXTRACTION_STEPS.findIndex((es) => es.step === currentExtractionStep)
      : -1;
    return EXTRACTION_STEPS.filter((s) => s.step !== 'complete').map((s) => {
      const stepIdx = EXTRACTION_STEPS.findIndex((es) => es.step === s.step);
      let status: 'done' | 'active' | 'pending' | 'failed' = 'pending';
      if (currentExtractionStep === 'complete' || stepIdx < currentIdx) status = 'done';
      else if (s.step === currentExtractionStep) status = 'active';
      return { id: s.step, label: t(`extraction.${s.step}`) || s.label, status };
    });
  }, [currentExtractionStep, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Flame className="h-6 w-6 text-primary/60" style={{ animation: 'breathe 2.5s ease-in-out infinite' }} />
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="container max-w-3xl mx-auto py-8 px-4 text-center">
        <p className="text-muted-foreground">{t('entity.detail.notFound')}</p>
        <Link href="/home">
          <Button variant="link" className="mt-2">{t('entity.detail.backHome')}</Button>
        </Link>
      </div>
    );
  }

  const isReady = entity.status === 'ready';
  const isDraft = entity.status === 'draft';
  const isError = entity.status === 'error';

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header: single primary "enter chat" CTA lives in the card below (SU-ITER-095) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Link href="/home">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <AvatarUpload
            avatarUrl={entity.avatarUrl}
            name={entity.name}
            size={48}
            onUpload={handleAvatarUpload}
            onRemove={entity.avatarUrl ? handleAvatarRemove : undefined}
            tooltipAdjacent={
              <div className="min-w-0">
                <h1 className="text-2xl font-bold font-[family-name:var(--font-display)]">{entity.name}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={isReady ? 'default' : isError ? 'destructive' : 'secondary'}>
                    {isReady ? t('entity.status.ready') : isDraft ? t('entity.status.pending') : isError ? t('entity.status.failed') : t('entity.status.extracting')}
                  </Badge>
                </div>
              </div>
            }
          />
        </div>
        <div className="shrink-0 flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowDeleteDialog(true)} className="text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Ready state: main CTA = chat, archive behind toggle (SU-ITER-040) */}
      {isReady && !showArchive && (
        <Card className="border-border bg-card overflow-hidden">
          <CardContent className="pt-6 text-center space-y-4 px-3 sm:px-6">
            <Link href={`/entities/${entity.id}/chat`}>
              <Button size="lg" className="shadow-[var(--shadow-warm-sm)]">
                <MessageCircle className="h-5 w-5 mr-2" /> {t('entity.detail.enterChat')}
              </Button>
            </Link>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 max-w-full">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowMemorySanctuary(true)}
              >
                <Archive className="h-3.5 w-3.5 mr-1.5" /> {t('entity.detail.showMemorySanctuary')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowArchive(true)}
              >
                <BookOpen className="h-3.5 w-3.5 mr-1.5" /> {t('entity.detail.archive')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowExportDialog(true)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> {t('export.title', { name: entity.name })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowOpenClawDialog(true)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> {t('openclaw.button')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowBackupDialog(true)}
              >
                <HardDriveDownload className="h-3.5 w-3.5 mr-1.5" /> {t('backup.entity.export')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowRestoreDialog(true)}
              >
                <HardDriveUpload className="h-3.5 w-3.5 mr-1.5" /> {t('backup.entity.import')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extraction progress — warm animated UI (SU-ITER-037) */}
      {extracting && (
        <Card className="border-border bg-card overflow-hidden">
          <CardContent className="pt-6 space-y-4">
            {/* Step indicators */}
            <div className="flex items-center justify-between px-2">
              {EXTRACTION_STEPS.filter((s) => s.step !== 'complete').map((s, idx) => {
                const stepKey = s.step as Exclude<ExtractionStep, 'complete'>;
                const stepIdx = EXTRACTION_STEPS.findIndex((es) => es.step === stepKey);
                const currentIdx = currentExtractionStep
                  ? EXTRACTION_STEPS.findIndex((es) => es.step === currentExtractionStep)
                  : -1;
                const isActive = s.step === currentExtractionStep;
                const isDone = stepIdx < currentIdx || (currentExtractionStep === 'complete');

                return (
                  <div key={s.step} className="flex flex-col items-center gap-1.5 flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-500 ${
                        isDone
                          ? 'bg-primary text-primary-foreground'
                          : isActive
                            ? 'bg-primary/20 text-primary ring-2 ring-primary/40'
                            : 'bg-muted text-muted-foreground'
                      }`}
                      style={isActive ? { animation: 'breathe 2s ease-in-out infinite' } : undefined}
                    >
                      {isDone ? '✓' : idx + 1}
                    </div>
                    <span className={`text-[10px] text-center leading-tight ${isActive ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {t(`extraction.${s.step}`) ? s.label : s.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Warm progress bar */}
            <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-primary/30 rounded-full"
                style={{ width: `${Math.min(progress + 5, 100)}%`, animation: 'breathe 2s ease-in-out infinite' }}
              />
            </div>

            {/* Narrative text */}
            <div className="flex items-center gap-3 min-h-[3rem]">
              <Flame className="h-5 w-5 text-primary shrink-0" style={{ animation: 'breathe 2s ease-in-out infinite' }} />
              <div className="space-y-0.5">
                <p className="text-sm text-foreground font-medium">{progressMessage}</p>
                <p className="text-xs text-muted-foreground transition-opacity duration-500" key={narrativeIdx}>
                  {getNarrativeMessage()}
                </p>
              </div>
            </div>

            <WorkflowProgress steps={extractionWorkflowSteps} />

            {/* Cancel button */}
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={cancelExtraction}
              >
                <X className="h-3.5 w-3.5 mr-1" /> {t('extraction.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Draft: show extract button */}
      {isDraft && !extracting && (
        <Card className="border-border bg-card">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">
              {t('entity.detail.questionnaireReady', { name: entity.name })}
            </p>
            <Button
              onClick={startExtraction}
              className="shadow-[var(--shadow-warm-sm)]"
            >
              <Flame className="h-4 w-4 mr-1" /> {t('entity.detail.extractStart')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {isError && (
        <Card className="border-destructive/30 bg-card">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-destructive">{t('entity.detail.problem', { error: entity.errorMessage ?? '' })}</p>
            <Button variant="outline" onClick={startExtraction}>{t('entity.detail.retryExtraction')}</Button>
          </CardContent>
        </Card>
      )}

      {/* Soul docs archive (SU-ITER-040: only visible when user deliberately opens) */}
      {showArchive && (isReady || entity.soulDocs.SOUL) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium font-[family-name:var(--font-display)]">
                {t('entity.detail.archive')}
              </h2>
              <p className="text-xs text-muted-foreground">{t('entity.detail.archiveHint')}</p>
            </div>
            <div className="flex gap-2">
              {isReady && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setShowOpenClawDialog(true)}>
                    <Sparkles className="h-3.5 w-3.5 mr-1" /> {t('openclaw.button')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowExportDialog(true)}>
                    <Download className="h-3.5 w-3.5 mr-1" /> {t('export.individual')}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowArchive(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start">
              {SOUL_DOC_KEYS_V1.map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  disabled={!entity.soulDocs[key]}
                  className="text-xs"
                >
                  {t(soulDocLabelKeys[key])}
                </TabsTrigger>
              ))}
            </TabsList>
            {SOUL_DOC_KEYS_V1.map((key) => (
              <TabsContent key={key} value={key}>
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg font-[family-name:var(--font-display)]">{t(soulDocLabelKeys[key])}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SoulDocViewer
                      content={entity.soulDocs[key]}
                      onSave={(content) => handleDocSave(key, content)}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}

      {/* Memory Sanctuary (记忆秘藏) — post-extraction material import */}
      {showMemorySanctuary && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium font-[family-name:var(--font-display)]">
                {t('entity.detail.memorySanctuary')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('entity.detail.memorySanctuaryHint')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowMemorySanctuary(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Chat Records Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium font-[family-name:var(--font-display)]">
              {t('entity.detail.chatTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('entity.detail.chatHint')}
            </p>
            <ChatRecordUpload
              materials={entity.chatMaterials ?? []}
              onMaterialsChange={handleChatMaterialsChange}
            />
          </div>

          {/* Text Materials Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium font-[family-name:var(--font-display)]">
              {t('entity.detail.materialsTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('entity.detail.materialsHint')}
            </p>
            <DocumentUpload
              materials={entity.textMaterials ?? []}
              onMaterialsChange={handleMaterialsChange}
            />
          </div>

          {isReady && ((entity.textMaterials?.length ?? 0) > 0 || (entity.chatMaterials?.length ?? 0) > 0 || (entity.webSearchMaterials?.length ?? 0) > 0) && (
            <Card className="border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{t('entity.detail.materialsReExtract')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('entity.detail.materialsReExtractHint')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startEnrichment}
                    disabled={extracting}
                  >
                    <Flame className="h-3.5 w-3.5 mr-1.5" />
                    {t('entity.detail.materialsReExtract')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Dialogs */}
      <DeleteEntityDialog
        entityName={entity.name}
        entityType={entity.type}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
      />
      {isReady && (
        <>
          <ExportDialog
            entity={entity}
            open={showExportDialog}
            onOpenChange={setShowExportDialog}
          />
          <OpenClawDialog
            entity={entity}
            open={showOpenClawDialog}
            onOpenChange={setShowOpenClawDialog}
          />
          <BackupEntityDialog
            entity={entity}
            open={showBackupDialog}
            onOpenChange={setShowBackupDialog}
          />
          <RestoreEntityDialog
            open={showRestoreDialog}
            onOpenChange={setShowRestoreDialog}
            onRestoreComplete={async () => {
              const e = await getEntity(id);
              if (e) setEntity(e);
            }}
          />
        </>
      )}
    </div>
  );
}
