'use client';

import type { QuestionnaireStep2, SpeechStyle, EntityType } from '@/types';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TagInput } from './tag-input';
import { useT } from '@/lib/i18n';

interface StepPersonalityProps {
  data: QuestionnaireStep2;
  onChange: (data: QuestionnaireStep2) => void;
  entityType?: EntityType;
}

export function StepPersonality({ data, onChange, entityType }: StepPersonalityProps) {
  const t = useT();

  const update = <K extends keyof QuestionnaireStep2>(
    key: K,
    value: QuestionnaireStep2[K]
  ) => {
    onChange({ ...data, [key]: value });
  };

  const updateSpeechStyle = <K extends keyof SpeechStyle>(
    key: K,
    value: SpeechStyle[K]
  ) => {
    onChange({
      ...data,
      speechStyle: { ...data.speechStyle, [key]: value },
    });
  };

  return (
    <div className="space-y-6">
      {/* Section intro */}
      <div className="space-y-1">
        <h3 className="text-lg font-medium text-foreground font-[family-name:var(--font-display)]">
          {t(entityType ? `questionnaire.personality.title.${entityType}` : 'questionnaire.personality.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(entityType ? `questionnaire.personality.desc.${entityType}` : 'questionnaire.personality.desc')}
        </p>
      </div>

      {/* Personality Keywords */}
      <div className="space-y-2">
        <Label>
          {t('questionnaire.personality.keywords')}{' '}
          <span className="text-primary">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.personality.keywordsHint')}
        </p>
        <TagInput
          tags={data.personalityKeywords}
          onChange={(tags) => update('personalityKeywords', tags)}
          placeholder={t(entityType ? `questionnaire.personality.keywordsPlaceholder.${entityType}` : 'questionnaire.personality.keywordsPlaceholder')}
          maxTags={10}
        />
      </div>

      {/* Speech Style */}
      <div className="space-y-4">
        <Label>
          {t('questionnaire.personality.speechStyle')}{' '}
          <span className="text-primary">*</span>
        </Label>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Formality */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">
              {t('questionnaire.personality.formality')}
            </Label>
            <Select
              value={data.speechStyle.formality}
              onValueChange={(v) =>
                updateSpeechStyle('formality', v as SpeechStyle['formality'])
              }
            >
              <SelectTrigger className="w-full bg-[hsl(var(--su-surface-2))]">
                <SelectValue placeholder={t('questionnaire.personality.formalityPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">{t('questionnaire.personality.formality.formal')}</SelectItem>
                <SelectItem value="casual">{t('questionnaire.personality.formality.casual')}</SelectItem>
                <SelectItem value="mixed">{t('questionnaire.personality.formality.mixed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Verbosity */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">
              {t('questionnaire.personality.verbosity')}
            </Label>
            <Select
              value={data.speechStyle.verbosity}
              onValueChange={(v) =>
                updateSpeechStyle('verbosity', v as SpeechStyle['verbosity'])
              }
            >
              <SelectTrigger className="w-full bg-[hsl(var(--su-surface-2))]">
                <SelectValue placeholder={t('questionnaire.personality.verbosityPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="talkative">{t('questionnaire.personality.verbosity.talkative')}</SelectItem>
                <SelectItem value="concise">{t('questionnaire.personality.verbosity.concise')}</SelectItem>
                <SelectItem value="balanced">{t('questionnaire.personality.verbosity.balanced')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Directness */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">
              {t('questionnaire.personality.directness')}
            </Label>
            <Select
              value={data.speechStyle.directness}
              onValueChange={(v) =>
                updateSpeechStyle('directness', v as SpeechStyle['directness'])
              }
            >
              <SelectTrigger className="w-full bg-[hsl(var(--su-surface-2))]">
                <SelectValue placeholder={t('questionnaire.personality.directnessPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">{t('questionnaire.personality.directness.direct')}</SelectItem>
                <SelectItem value="indirect">{t('questionnaire.personality.directness.indirect')}</SelectItem>
                <SelectItem value="mixed">{t('questionnaire.personality.directness.mixed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Core Values */}
      <div className="space-y-2">
        <Label>
          {t('questionnaire.personality.values')}{' '}
          <span className="text-primary">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.personality.valuesHint')}
        </p>
        <TagInput
          tags={data.coreValues}
          onChange={(tags) => update('coreValues', tags)}
          placeholder={t('questionnaire.personality.valuesPlaceholder')}
          maxTags={3}
        />
      </div>

      {/* Catchphrases */}
      <div className="space-y-2">
        <Label>
          {t('questionnaire.personality.catchphrases')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.personality.catchphrasesHint')}
        </p>
        <TagInput
          tags={data.catchphrases}
          onChange={(tags) => update('catchphrases', tags)}
          placeholder={t(entityType ? `questionnaire.personality.catchphrasesPlaceholder.${entityType}` : 'questionnaire.personality.catchphrasesPlaceholder')}
        />
      </div>
    </div>
  );
}
