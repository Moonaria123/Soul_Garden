'use client';

import type { QuestionnaireStep3, EntityType } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from './tag-input';
import { useT } from '@/lib/i18n';

interface StepEmotionsProps {
  data: QuestionnaireStep3;
  onChange: (data: QuestionnaireStep3) => void;
  entityType?: EntityType;
}

export function StepEmotions({ data, onChange, entityType }: StepEmotionsProps) {
  const t = useT();

  const updateReaction = (
    key: keyof QuestionnaireStep3['emotionalReactions'],
    value: string
  ) => {
    onChange({
      ...data,
      emotionalReactions: { ...data.emotionalReactions, [key]: value },
    });
  };

  return (
    <div className="space-y-6">
      {/* Section intro */}
      <div className="space-y-1">
        <h3 className="text-lg font-medium text-foreground font-[family-name:var(--font-display)]">
          {t(entityType ? `questionnaire.emotions.title.${entityType}` : 'questionnaire.emotions.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(entityType ? `questionnaire.emotions.desc.${entityType}` : 'questionnaire.emotions.desc')}
        </p>
      </div>

      {/* Emotional Reactions */}
      <div className="space-y-5">
        <Label className="text-base">
          {t('questionnaire.emotions.reactions')}{' '}
          <span className="text-primary">*</span>
        </Label>

        {/* When Happy */}
        <div className="space-y-2">
          <Label
            htmlFor="whenHappy"
            className="text-sm text-foreground"
          >
            {t('questionnaire.emotions.whenHappy')}
          </Label>
          <Textarea
            id="whenHappy"
            value={data.emotionalReactions.whenHappy}
            onChange={(e) => updateReaction('whenHappy', e.target.value)}
            placeholder={t(entityType ? `questionnaire.emotions.whenHappyPlaceholder.${entityType}` : 'questionnaire.emotions.whenHappyPlaceholder')}
            className="bg-[hsl(var(--su-surface-2))] min-h-24"
          />
        </div>

        {/* When Angry */}
        <div className="space-y-2">
          <Label
            htmlFor="whenAngry"
            className="text-sm text-foreground"
          >
            {t('questionnaire.emotions.whenAngry')}
          </Label>
          <Textarea
            id="whenAngry"
            value={data.emotionalReactions.whenAngry}
            onChange={(e) => updateReaction('whenAngry', e.target.value)}
            placeholder={t(entityType ? `questionnaire.emotions.whenAngryPlaceholder.${entityType}` : 'questionnaire.emotions.whenAngryPlaceholder')}
            className="bg-[hsl(var(--su-surface-2))] min-h-24"
          />
        </div>

        {/* When Hurt */}
        <div className="space-y-2">
          <Label
            htmlFor="whenHurt"
            className="text-sm text-foreground"
          >
            {t('questionnaire.emotions.whenHurt')}
          </Label>
          <Textarea
            id="whenHurt"
            value={data.emotionalReactions.whenHurt}
            onChange={(e) => updateReaction('whenHurt', e.target.value)}
            placeholder={t(entityType ? `questionnaire.emotions.whenHurtPlaceholder.${entityType}` : 'questionnaire.emotions.whenHurtPlaceholder')}
            className="bg-[hsl(var(--su-surface-2))] min-h-24"
          />
        </div>
      </div>

      {/* Taboo Topics */}
      <div className="space-y-2">
        <Label>
          {t('questionnaire.emotions.taboo')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.emotions.tabooHint')}
        </p>
        <TagInput
          tags={data.tabooTopics}
          onChange={(tags) => onChange({ ...data, tabooTopics: tags })}
          placeholder={t(entityType ? `questionnaire.emotions.tabooPlaceholder.${entityType}` : 'questionnaire.emotions.tabooPlaceholder')}
        />
      </div>

      {/* Typical Mood */}
      <div className="space-y-2">
        <Label htmlFor="mood">
          {t('questionnaire.emotions.mood')}{' '}
          <span className="text-primary">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.emotions.moodHint')}
        </p>
        <Input
          id="mood"
          value={data.typicalMood}
          onChange={(e) => onChange({ ...data, typicalMood: e.target.value })}
          placeholder={t(entityType ? `questionnaire.emotions.moodPlaceholder.${entityType}` : 'questionnaire.emotions.moodPlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>
    </div>
  );
}
