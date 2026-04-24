'use client';

import type { QuestionnaireStep4, EntityType } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';

interface StepRelationshipProps {
  data: QuestionnaireStep4;
  entityType: EntityType;
  onChange: (data: QuestionnaireStep4) => void;
}

export function StepRelationship({
  data,
  entityType,
  onChange,
}: StepRelationshipProps) {
  const t = useT();

  const update = <K extends keyof QuestionnaireStep4>(
    key: K,
    value: QuestionnaireStep4[K]
  ) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* Section intro */}
      <div className="space-y-1">
        <h3 className="text-lg font-medium text-foreground font-[family-name:var(--font-display)]">
          {t(entityType ? `questionnaire.relationship.title.${entityType}` : 'questionnaire.relationship.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(entityType ? `questionnaire.relationship.desc.${entityType}` : 'questionnaire.relationship.desc')}
        </p>
      </div>

      {/* Relationship Type */}
      <div className="space-y-2">
        <Label htmlFor="relType">
          {t('questionnaire.relationship.type')}{' '}
          <span className="text-primary">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.relationship.typeHint')}
        </p>
        <Input
          id="relType"
          value={data.relationshipType}
          onChange={(e) => update('relationshipType', e.target.value)}
          placeholder={t(entityType ? `questionnaire.relationship.typePlaceholder.${entityType}` : 'questionnaire.relationship.typePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Interaction Mode */}
      <div className="space-y-2">
        <Label htmlFor="interaction">
          {t('questionnaire.relationship.mode')}{' '}
          <span className="text-primary">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.relationship.modeHint')}
        </p>
        <Input
          id="interaction"
          value={data.interactionMode}
          onChange={(e) => update('interactionMode', e.target.value)}
          placeholder={t(entityType ? `questionnaire.relationship.modePlaceholder.${entityType}` : 'questionnaire.relationship.modePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* SU-ITER-039: User Identity — how the entity calls the user */}
      <div className="space-y-2">
        <Label htmlFor="userCallName">
          {t('questionnaire.relationship.userCallName')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.relationship.userCallNameHint')}
        </p>
        <Input
          id="userCallName"
          value={data.userCallName || ''}
          onChange={(e) => update('userCallName', e.target.value)}
          placeholder={t(entityType ? `questionnaire.relationship.userCallNamePlaceholder.${entityType}` : 'questionnaire.relationship.userCallNamePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* SU-ITER-039: User Identity — how the entity perceives/feels about the user */}
      <div className="space-y-2">
        <Label htmlFor="userPerception">
          {t('questionnaire.relationship.userPerception')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.relationship.userPerceptionHint')}
        </p>
        <Textarea
          id="userPerception"
          value={data.userPerception || ''}
          onChange={(e) => update('userPerception', e.target.value)}
          placeholder={t(entityType ? `questionnaire.relationship.userPerceptionPlaceholder.${entityType}` : 'questionnaire.relationship.userPerceptionPlaceholder')}
          className="bg-[hsl(var(--su-surface-2))] min-h-20"
        />
      </div>

      {/* Supplementary Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">
          {t('questionnaire.relationship.notes')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('questionnaire.relationship.notesHint')}
        </p>
        <Textarea
          id="notes"
          value={data.supplementaryNotes}
          onChange={(e) => update('supplementaryNotes', e.target.value)}
          placeholder={t(entityType ? `questionnaire.relationship.notesPlaceholder.${entityType}` : 'questionnaire.relationship.notesPlaceholder')}
          className="bg-[hsl(var(--su-surface-2))] min-h-28"
        />
      </div>

      {/* Ethics consent checkbox — only for real persons */}
      {entityType === 'real_person' && (
        <div className="rounded-lg border border-border bg-[hsl(var(--su-primary-highlight))] p-4 space-y-3">
          <p className="text-sm text-foreground font-medium font-[family-name:var(--font-display)]">
            {t('questionnaire.relationship.ethicsTitle')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('questionnaire.relationship.ethicsDesc')}
          </p>
          {data.ethicsConsentAcknowledged && (
            <p className="text-xs text-primary">
              {t('questionnaire.relationship.ethicsConfirmed')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
