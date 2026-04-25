'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type {
  EntityType,
  TextMaterial,
  QuestionnaireData,
  QuestionnaireStep1,
  QuestionnaireStep2,
  QuestionnaireStep3,
  QuestionnaireStep4,
} from '@/types';
import { useEntityStore } from '@/lib/store/entity-store';
import {
  hasRecoverableNewEntityDraft,
  type NewEntityDraftPayload,
} from '@/lib/store/entity-schemas';
import { useSearchConfigStore } from '@/lib/store/search-config-store';
import { useProviderStore } from '@/lib/store/provider-store';
import { toast } from 'sonner';
import { Stepper } from '@/components/questionnaire/stepper';
import { StepBasicInfo } from '@/components/questionnaire/step-basic-info';
import { StepPersonality } from '@/components/questionnaire/step-personality';
import { StepEmotions } from '@/components/questionnaire/step-emotions';
import { StepRelationship } from '@/components/questionnaire/step-relationship';
import { EthicsConsentModal } from '@/components/questionnaire/ethics-consent-modal';
import { DocumentUpload } from '@/components/materials/document-upload';
import { ChatRecordUpload } from '@/components/materials/chat-record-upload';
import { SummonGate } from '@/components/fictional-summon/summon-gate';
import { DimensionalBreakStep } from '@/components/dimensional-break/dimensional-break-step';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Flame, User, BookOpen, Wand2, SkipForward } from 'lucide-react';
import { AvatarUpload } from '@/components/entity/avatar-upload';
import { useT } from '@/lib/i18n';
import Link from 'next/link';
import { autoFillQuestionnaire } from '@/lib/search/questionnaire-autofill-service';
import type { DimensionalBreakResult } from '@/lib/search/search-types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const EMPTY_STEP1: QuestionnaireStep1 = {
  name: '',
  gender: '',
  approximateAge: '',
  culturalBackground: '',
  primaryLanguages: [],
};

const EMPTY_STEP2: QuestionnaireStep2 = {
  personalityKeywords: [],
  speechStyle: { formality: 'casual', verbosity: 'balanced', directness: 'mixed' },
  coreValues: [],
  catchphrases: [],
};

const EMPTY_STEP3: QuestionnaireStep3 = {
  emotionalReactions: { whenHappy: '', whenAngry: '', whenHurt: '' },
  tabooTopics: [],
  typicalMood: '',
};

const EMPTY_STEP4: QuestionnaireStep4 = {
  relationshipType: '',
  interactionMode: '',
  supplementaryNotes: '',
};

export default function NewEntityPage() {
  const router = useRouter();
  const t = useT();
  const { createEntity, saveDraft, loadDraft, clearDraft } = useEntityStore();

  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [step1, setStep1] = useState<QuestionnaireStep1>(EMPTY_STEP1);
  const [step2, setStep2] = useState<QuestionnaireStep2>(EMPTY_STEP2);
  const [step3, setStep3] = useState<QuestionnaireStep3>(EMPTY_STEP3);
  const [step4, setStep4] = useState<QuestionnaireStep4>(EMPTY_STEP4);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [textMaterials, setTextMaterials] = useState<TextMaterial[]>([]);
  const [chatMaterials, setChatMaterials] = useState<TextMaterial[]>([]);
  const [webSearchMaterials, setWebSearchMaterials] = useState<TextMaterial[]>([]);
  const [dimensionalBreakResult, setDimensionalBreakResult] = useState<DimensionalBreakResult | null>(null);
  const [showEthicsModal, setShowEthicsModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emptyMaterialsDialogOpen, setEmptyMaterialsDialogOpen] = useState(false);
  const [draftHintVisible, setDraftHintVisible] = useState(false);

  // Fictional Summon Gate state
  const [showSummonGate, setShowSummonGate] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillProgress, setAutoFillProgress] = useState<string | undefined>();
  const [autoFillError, setAutoFillError] = useState<string | undefined>();

  const QUESTIONNAIRE_STEP_COUNT = 4;
  const STEP4_INDEX = 4; // Chat import (real_person/custom) OR Dimensional Break (fictional)
  const MATERIALS_STEP_INDEX = 5;

  const isFictional = entityType === 'fictional';

  const steps = [
    { label: t('new.step.know') },
    { label: t('new.step.personality') },
    { label: t('new.step.emotions') },
    { label: t('new.step.relationship') },
    { label: isFictional ? t('new.step.dimensionalBreak') : t('new.step.chatImport') },
    { label: t('new.step.materials') },
  ];

  const entityTypeOptions: { value: EntityType; label: string; icon: React.ReactNode; desc: string }[] = [
    { value: 'fictional', label: t('new.type.fictional'), icon: <Wand2 className="h-5 w-5" />, desc: t('new.type.fictional.desc') },
    { value: 'real_person', label: t('new.type.real'), icon: <User className="h-5 w-5" />, desc: t('new.type.real.desc') },
    { value: 'custom', label: t('new.type.custom'), icon: <BookOpen className="h-5 w-5" />, desc: t('new.type.custom.desc') },
  ];

  // Debounced auto-save (questionnaire + fictional dimensional break + materials + avatar)
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoSave = useCallback(() => {
    if (!entityType) return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      const payload: NewEntityDraftPayload = {
        entityType,
        step1,
        step2,
        step3,
        step4,
      };
      if (entityType === 'fictional') {
        if (dimensionalBreakResult) payload.dimensionalBreakResult = dimensionalBreakResult;
        if (webSearchMaterials.length > 0) payload.webSearchMaterials = webSearchMaterials;
        if (textMaterials.length > 0) payload.textMaterials = textMaterials;
        if (chatMaterials.length > 0) payload.chatMaterials = chatMaterials;
        if (avatarUrl) payload.avatarUrl = avatarUrl;
      } else {
        if (textMaterials.length > 0) payload.textMaterials = textMaterials;
        if (chatMaterials.length > 0) payload.chatMaterials = chatMaterials;
        if (avatarUrl) payload.avatarUrl = avatarUrl;
      }
      saveDraft(entityType, payload);
    }, 1000);
  }, [
    entityType,
    step1,
    step2,
    step3,
    step4,
    dimensionalBreakResult,
    webSearchMaterials,
    textMaterials,
    chatMaterials,
    avatarUrl,
    saveDraft,
  ]);

  useEffect(() => {
    autoSave();
    return () => clearTimeout(saveTimeout.current);
  }, [autoSave]);

  useEffect(() => {
    if (!entityType) setDraftHintVisible(false);
  }, [entityType]);

  // Load draft when entity type is selected + single-draft hint
  useEffect(() => {
    if (!entityType) return;
    const hintKey = `su_new_entity_draft_hint_${entityType}`;
    loadDraft(entityType).then((draft) => {
      if (draft) {
        if (draft.step1) setStep1(draft.step1);
        if (draft.step2) setStep2(draft.step2);
        if (draft.step3) setStep3(draft.step3);
        if (draft.step4) setStep4(draft.step4);
      }
      if (entityType === 'fictional') {
        if (draft) {
          setDimensionalBreakResult(draft.dimensionalBreakResult ?? null);
          setWebSearchMaterials(draft.webSearchMaterials ?? []);
          setTextMaterials(draft.textMaterials ?? []);
          setChatMaterials(draft.chatMaterials ?? []);
          if (draft.avatarUrl) setAvatarUrl(draft.avatarUrl);
        } else {
          setDimensionalBreakResult(null);
          setWebSearchMaterials([]);
          setTextMaterials([]);
          setChatMaterials([]);
          setAvatarUrl(undefined);
        }
      } else {
        setDimensionalBreakResult(null);
        setWebSearchMaterials([]);
        if (draft) {
          setTextMaterials(draft.textMaterials ?? []);
          setChatMaterials(draft.chatMaterials ?? []);
          if (draft.avatarUrl) setAvatarUrl(draft.avatarUrl);
        } else {
          setTextMaterials([]);
          setChatMaterials([]);
          setAvatarUrl(undefined);
        }
      }
      const showHint =
        typeof window !== 'undefined' &&
        hasRecoverableNewEntityDraft(draft) &&
        !sessionStorage.getItem(hintKey);
      setDraftHintVisible(showHint);
    });
  }, [entityType, loadDraft]);

  const dismissDraftHint = useCallback(() => {
    if (entityType && typeof window !== 'undefined') {
      sessionStorage.setItem(`su_new_entity_draft_hint_${entityType}`, '1');
    }
    setDraftHintVisible(false);
  }, [entityType]);

  const getStepValidationIssues = useCallback((): string[] => {
    const issues: string[] = [];
    switch (currentStep) {
      case 0:
        if (!step1.name.trim()) issues.push(t('questionnaire.basic.name'));
        if (!step1.gender.trim()) issues.push(t('questionnaire.basic.gender'));
        if (!step1.approximateAge.trim()) issues.push(t('questionnaire.basic.age'));
        if (!step1.culturalBackground.trim()) issues.push(t('questionnaire.basic.culture'));
        if (step1.primaryLanguages.length === 0) issues.push(t('questionnaire.basic.languages'));
        break;
      case 1:
        if (step2.personalityKeywords.length < 3) issues.push(t('new.validation.minPersonalityKeywords'));
        if (step2.coreValues.length < 1) issues.push(t('new.validation.minCoreValues'));
        break;
      case 2:
        if (!step3.emotionalReactions.whenHappy.trim()) issues.push(t('questionnaire.emotions.whenHappy'));
        if (!step3.emotionalReactions.whenAngry.trim()) issues.push(t('questionnaire.emotions.whenAngry'));
        if (!step3.emotionalReactions.whenHurt.trim()) issues.push(t('questionnaire.emotions.whenHurt'));
        if (!step3.typicalMood.trim()) issues.push(t('questionnaire.emotions.mood'));
        break;
      case 3:
        if (!step4.relationshipType.trim()) issues.push(t('questionnaire.relationship.type'));
        if (!step4.interactionMode.trim()) issues.push(t('questionnaire.relationship.mode'));
        break;
      default:
        break;
    }
    return issues;
  }, [currentStep, step1, step2, step3, step4, t]);

  const showValidationToast = useCallback(
    (issues: string[]) => {
      toast.error(t('new.validation.title'), {
        description: issues.join(t('new.validation.separator')),
      });
    },
    [t]
  );

  const handleNext = () => {
    if (currentStep < QUESTIONNAIRE_STEP_COUNT) {
      const issues = getStepValidationIssues();
      if (issues.length > 0) {
        showValidationToast(issues);
        return;
      }
    }

    if (currentStep === QUESTIONNAIRE_STEP_COUNT - 1) {
      if (entityType === 'real_person' && !step4.ethicsConsentAcknowledged) {
        setShowEthicsModal(true);
        return;
      }
      setCurrentStep(STEP4_INDEX);
      return;
    }

    if (currentStep === STEP4_INDEX) {
      setCurrentStep(MATERIALS_STEP_INDEX);
      return;
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep === MATERIALS_STEP_INDEX) {
      setCurrentStep(STEP4_INDEX);
      return;
    }
    if (currentStep === STEP4_INDEX) {
      setCurrentStep(QUESTIONNAIRE_STEP_COUNT - 1);
      return;
    }
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  // SU-ITER-092-batch3 · A4-MEDIUM — `doSubmit` previously asserted
  // `entityType!` twice even though the parent component early-returns
  // when `entityType === null` (see the `if (!entityType) return;`
  // render guard further down).  Threading the narrowed value in via a
  // parameter moves the nullability check to the caller, where the
  // guard is lexically closer, and lets the function body rely on a
  // proper `EntityType` type without assertions.
  const doSubmit = async (resolvedEntityType: EntityType) => {
    setIsSubmitting(true);
    try {
      const questionnaire: QuestionnaireData = {
        entityType: resolvedEntityType,
        step1,
        step2,
        step3,
        step4,
      };

      const entity = await createEntity(questionnaire);
      const { updateEntity } = useEntityStore.getState();
      const updates: Partial<typeof entity> = {};
      if (avatarUrl) updates.avatarUrl = avatarUrl;
      if (textMaterials.length > 0) updates.textMaterials = textMaterials;
      if (chatMaterials.length > 0) updates.chatMaterials = chatMaterials;
      if (webSearchMaterials.length > 0) updates.webSearchMaterials = webSearchMaterials;
      if (Object.keys(updates).length > 0) {
        await updateEntity(entity.id, updates);
      }
      await clearDraft(resolvedEntityType);
      router.push(`/entities/${entity.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!entityType) return;
    if (currentStep < MATERIALS_STEP_INDEX) {
      const issues = getStepValidationIssues();
      if (issues.length > 0) {
        showValidationToast(issues);
        return;
      }
    }
    if (currentStep === MATERIALS_STEP_INDEX && textMaterials.length === 0) {
      setEmptyMaterialsDialogOpen(true);
      return;
    }
    await doSubmit(entityType);
  };

  const handleSkipMaterials = async () => {
    if (!entityType) return;
    await doSubmit(entityType);
  };

  const handleEthicsConfirm = () => {
    setStep4((prev) => ({ ...prev, ethicsConsentAcknowledged: true }));
    setShowEthicsModal(false);
    setCurrentStep(STEP4_INDEX);
  };

  // --- Summon Gate handlers ---

  const handleEntityTypeSelect = (type: EntityType) => {
    setEntityType(type);
    if (type === 'fictional') {
      setShowSummonGate(true);
    }
  };

  const handleManualSummon = (name: string, workName: string) => {
    setStep1((prev) => ({
      ...prev,
      name,
      fictionalWorkName: workName || undefined,
    }));
    setShowSummonGate(false);
    setAutoFillError(undefined);
  };

  const handleAutoSummon = async (name: string, workName: string) => {
    setIsAutoFilling(true);
    setAutoFillError(undefined);
    setAutoFillProgress(undefined);

    try {
      const searchConfig = useSearchConfigStore.getState();
      const llmOpts = await useProviderStore.getState().getActiveLLMOptions();
      if (!llmOpts) {
        throw new Error(t('new.summonGate.noLLMError'));
      }

      let decryptedApiKey: string | undefined;
      const activeConfig = searchConfig.toolConfigs.find(
        (c) => c.type === searchConfig.activeTool
      );
      if (activeConfig && searchConfig.activeTool !== 'llm-native') {
        decryptedApiKey = await searchConfig.getDecryptedApiKey(activeConfig);
      }

      const result = await autoFillQuestionnaire({
        characterName: name,
        workName: workName || '',
        activeTool: searchConfig.activeTool,
        toolConfig: activeConfig,
        decryptedApiKey,
        whitelist: searchConfig.whitelists.fictionalSummon,
        llmOptions: llmOpts,
        onProgress: setAutoFillProgress,
      });

      // Merge auto-fill results
      setStep1((prev) => ({ ...prev, ...result.step1 }));
      if (result.step2 && Object.keys(result.step2).length > 0) {
        setStep2((prev) => ({
          ...prev,
          ...result.step2,
          speechStyle: result.step2?.speechStyle
            ? { ...prev.speechStyle, ...result.step2.speechStyle }
            : prev.speechStyle,
        }));
      }
      if (result.step3 && Object.keys(result.step3).length > 0) {
        setStep3((prev) => ({
          ...prev,
          ...result.step3,
          emotionalReactions: result.step3?.emotionalReactions
            ? { ...prev.emotionalReactions, ...result.step3.emotionalReactions }
            : prev.emotionalReactions,
        }));
      }

      setShowSummonGate(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auto-fill failed';
      setAutoFillError(msg);
    } finally {
      setIsAutoFilling(false);
      setAutoFillProgress(undefined);
    }
  };

  // Entity type selection screen
  if (!entityType) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/home">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-[family-name:var(--font-display)]">{t('new.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('new.selectType')}</p>
          </div>
        </div>

        <div className="grid gap-4">
          {entityTypeOptions.map((opt) => (
            <Card
              key={opt.value}
              className="cursor-pointer border-border bg-card transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-warm-md)]"
              onClick={() => handleEntityTypeSelect(opt.value)}
            >
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex items-center justify-center size-12 rounded-xl border border-border bg-[hsl(var(--su-primary-highlight))] text-primary">
                  {opt.icon}
                </div>
                <div>
                  <p className="font-medium text-foreground font-[family-name:var(--font-display)]">{opt.label}</p>
                  <p className="text-sm text-muted-foreground">{opt.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Fictional Summon Gate screen
  if (showSummonGate) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setShowSummonGate(false);
              setEntityType(null);
              setAutoFillError(undefined);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold font-[family-name:var(--font-display)]">
              {t('new.type.fictional')}
            </h1>
          </div>
        </div>

        <SummonGate
          onManualSummon={handleManualSummon}
          onAutoSummon={handleAutoSummon}
          isAutoFilling={isAutoFilling}
          autoFillProgress={autoFillProgress}
          autoFillError={autoFillError}
        />
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto py-8 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/home">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <AvatarUpload
          avatarUrl={avatarUrl}
          name={step1.name || '?'}
          size={44}
          onUpload={setAvatarUrl}
          onRemove={avatarUrl ? () => setAvatarUrl(undefined) : undefined}
          tooltipAdjacent={
            <div className="flex-1 min-w-0 pt-0.5">
              <h1 className="text-xl font-bold font-[family-name:var(--font-display)]">
                {step1.name ? t('new.createSoul', { name: step1.name }) : t('new.title')}
              </h1>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {entityTypeOptions.find((o) => o.value === entityType)?.label}
                </Badge>
                <button
                  type="button"
                  onClick={() => { setEntityType(null); setCurrentStep(0); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('new.changeType')}
                </button>
              </div>
            </div>
          }
        />
      </div>

      {/* Stepper */}
      <Stepper currentStep={currentStep} steps={steps} />

      {draftHintVisible && (
        <div
          role="status"
          className="rounded-xl border border-border bg-[hsl(var(--su-surface-2))] p-4 text-sm shadow-[var(--shadow-warm-sm)]"
        >
          <p className="font-medium font-[family-name:var(--font-display)] text-foreground">
            {t('new.draft.singleHint')}
          </p>
          <p className="mt-2 text-muted-foreground leading-relaxed">
            {t('new.draft.singleHintDetail')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={dismissDraftHint}
          >
            {t('new.draft.dismiss')}
          </Button>
        </div>
      )}

      {/* Step content */}
      <Card className="border-border bg-card shadow-[var(--shadow-warm-sm)]">
        <CardContent className="pt-6">
          {currentStep === 0 && (
            <StepBasicInfo data={step1} onChange={setStep1} entityType={entityType} />
          )}
          {currentStep === 1 && (
            <StepPersonality data={step2} onChange={setStep2} entityType={entityType} />
          )}
          {currentStep === 2 && (
            <StepEmotions data={step3} onChange={setStep3} entityType={entityType} />
          )}
          {currentStep === 3 && (
            <StepRelationship data={step4} entityType={entityType} onChange={setStep4} />
          )}
          {currentStep === STEP4_INDEX && isFictional && (
            <DimensionalBreakStep
              characterName={step1.name}
              workName={step1.fictionalWorkName || ''}
              webSearchMaterials={webSearchMaterials}
              onMaterialsChange={setWebSearchMaterials}
              dimensionalBreakResult={dimensionalBreakResult}
              onDimensionalBreakResultChange={setDimensionalBreakResult}
            />
          )}
          {currentStep === STEP4_INDEX && !isFictional && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium font-[family-name:var(--font-display)]">
                  {t('new.chatImport.title')}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('new.chatImport.subtitle')}
                </p>
              </div>
              <ChatRecordUpload
                materials={chatMaterials}
                onMaterialsChange={setChatMaterials}
              />
            </div>
          )}
          {currentStep === MATERIALS_STEP_INDEX && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium font-[family-name:var(--font-display)]">
                  {t('new.materials.title')}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('new.materials.subtitle')}
                </p>
                <p className="text-xs text-muted-foreground/80">
                  {t('new.materials.extraHint')}
                </p>
              </div>
              {isFictional &&
                webSearchMaterials.some((m) => m.id.startsWith('web-search-')) && (
                  <div className="space-y-2 rounded-lg border border-border bg-[hsl(var(--su-surface-2))]/60 p-4">
                    <h4 className="text-sm font-medium font-[family-name:var(--font-display)]">
                      {t('new.materials.dimensionalSectionTitle')}
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t('new.materials.dimensionalSectionSubtitle')}
                    </p>
                    <div className="space-y-3">
                      {webSearchMaterials
                        .filter((m) => m.id.startsWith('web-search-'))
                        .map((m) => (
                          <div
                            key={m.id}
                            className="rounded-md border border-border/80 bg-card/50 p-3 text-xs"
                          >
                            <p className="font-medium text-foreground truncate">{m.filename}</p>
                            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground leading-relaxed">
                              {m.content}
                            </pre>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              <DocumentUpload
                materials={textMaterials}
                onMaterialsChange={setTextMaterials}
              />
              <p className="text-xs text-muted-foreground/70 text-center">
                {t('new.materials.skipHint')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> {t('new.prev')}
        </Button>

        {currentStep < QUESTIONNAIRE_STEP_COUNT - 1 ? (
          <Button type="button" onClick={handleNext}>
            {t('new.next')} <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : currentStep === QUESTIONNAIRE_STEP_COUNT - 1 ? (
          <Button type="button" onClick={handleNext}>
            {t('new.next')} <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : currentStep === STEP4_INDEX ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleNext}
              className="text-muted-foreground"
            >
              <SkipForward className="h-4 w-4 mr-1" />
              {isFictional ? t('new.dimensionalBreak.skip') : t('new.chatImport.skip')}
            </Button>
            {((isFictional && webSearchMaterials.length > 0) ||
              (!isFictional && chatMaterials.length > 0)) && (
              <Button type="button" onClick={handleNext}>
                {isFictional ? t('new.dimensionalBreak.continue') : t('new.chatImport.continue')}{' '}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        ) : currentStep === MATERIALS_STEP_INDEX ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleSkipMaterials}
              disabled={isSubmitting}
              className="text-muted-foreground"
            >
              <SkipForward className="h-4 w-4 mr-1" />
              {t('new.materials.skip')}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="shadow-[var(--shadow-warm-sm)]"
            >
              <Flame className="h-4 w-4 mr-1" />
              {isSubmitting ? t('new.submitting') : t('new.submit')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="shadow-[var(--shadow-warm-sm)]"
          >
            <Flame className="h-4 w-4 mr-1" />
            {isSubmitting ? t('new.submitting') : t('new.submit')}
          </Button>
        )}
      </div>

      {/* Ethics consent modal for real persons */}
      <EthicsConsentModal
        open={showEthicsModal}
        onConfirm={handleEthicsConfirm}
        onCancel={() => setShowEthicsModal(false)}
      />

      <AlertDialog open={emptyMaterialsDialogOpen} onOpenChange={setEmptyMaterialsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('new.materials.emptyConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('new.materials.emptyConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('new.materials.emptyConfirmNo')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (entityType) {
                  void doSubmit(entityType);
                }
              }}
            >
              {t('new.materials.emptyConfirmYes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
