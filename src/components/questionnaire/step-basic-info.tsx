'use client';

import type { QuestionnaireStep1, EntityType } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TagInput } from './tag-input';
import { useT } from '@/lib/i18n';

interface StepBasicInfoProps {
  data: QuestionnaireStep1;
  onChange: (data: QuestionnaireStep1) => void;
  entityType?: EntityType;
}

export function StepBasicInfo({ data, onChange, entityType }: StepBasicInfoProps) {
  const t = useT();

  const update = <K extends keyof QuestionnaireStep1>(
    key: K,
    value: QuestionnaireStep1[K]
  ) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* Section intro */}
      <div className="space-y-1">
        <h3 className="text-lg font-medium text-foreground font-[family-name:var(--font-display)]">
          {t('questionnaire.basic.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('questionnaire.basic.desc')}
        </p>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          {t('questionnaire.basic.name')} <span className="text-primary">*</span>
        </Label>
        <Input
          id="name"
          value={data.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder={t('questionnaire.basic.namePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Gender */}
      <div className="space-y-2">
        <Label htmlFor="gender">
          {t('questionnaire.basic.gender')} <span className="text-primary">*</span>
        </Label>
        <Input
          id="gender"
          value={data.gender}
          onChange={(e) => update('gender', e.target.value)}
          placeholder={t('questionnaire.basic.genderPlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Approximate Age */}
      <div className="space-y-2">
        <Label htmlFor="age">
          {t('questionnaire.basic.age')} <span className="text-primary">*</span>
        </Label>
        <Input
          id="age"
          value={data.approximateAge}
          onChange={(e) => update('approximateAge', e.target.value)}
          placeholder={t('questionnaire.basic.agePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Cultural Background */}
      <div className="space-y-2">
        <Label htmlFor="culture">
          {t('questionnaire.basic.culture')} <span className="text-primary">*</span>
        </Label>
        <Input
          id="culture"
          value={data.culturalBackground}
          onChange={(e) => update('culturalBackground', e.target.value)}
          placeholder={t('questionnaire.basic.culturePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Primary Languages */}
      <div className="space-y-2">
        <Label>
          {t('questionnaire.basic.languages')} <span className="text-primary">*</span>
        </Label>
        <TagInput
          tags={data.primaryLanguages}
          onChange={(tags) => update('primaryLanguages', tags)}
          placeholder={t('questionnaire.basic.languagesPlaceholder')}
        />
      </div>

      {/* Appearance Description (optional) */}
      <div className="space-y-2">
        <Label htmlFor="appearance">
          {t('questionnaire.basic.appearance')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <Textarea
          id="appearance"
          value={data.appearanceDescription ?? ''}
          onChange={(e) => update('appearanceDescription', e.target.value)}
          placeholder={t('questionnaire.basic.appearancePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))] min-h-20"
        />
      </div>

      {/* Voice Description (optional) */}
      <div className="space-y-2">
        <Label htmlFor="voice">
          {t('questionnaire.basic.voice')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <Textarea
          id="voice"
          value={data.voiceDescription ?? ''}
          onChange={(e) => update('voiceDescription', e.target.value)}
          placeholder={t('questionnaire.basic.voicePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))] min-h-20"
        />
      </div>

      {/* Informal Nickname (SU-ITER-046, optional) */}
      <div className="space-y-2">
        <Label htmlFor="informalNickname">
          {t('questionnaire.basic.informalNickname')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <Input
          id="informalNickname"
          value={data.informalNickname ?? ''}
          onChange={(e) => update('informalNickname', e.target.value)}
          placeholder={t('questionnaire.basic.informalNicknamePlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Region (SU-ITER-046, optional) */}
      <div className="space-y-2">
        <Label htmlFor="region">
          {t('questionnaire.basic.region')}{' '}
          <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
        </Label>
        <Input
          id="region"
          value={data.region ?? ''}
          onChange={(e) => update('region', e.target.value)}
          placeholder={t('questionnaire.basic.regionPlaceholder')}
          className="bg-[hsl(var(--su-surface-2))]"
        />
      </div>

      {/* Type-specific fields (SU-ITER-024) */}
      {entityType === 'fictional' && (
        <>
          <Separator />
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-foreground">{t('questionnaire.basic.fictional.section')}</h4>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fictional-work">
              {t('questionnaire.basic.fictional.workName')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Input
              id="fictional-work"
              value={data.fictionalWorkName ?? ''}
              onChange={(e) => update('fictionalWorkName', e.target.value)}
              placeholder={t('questionnaire.basic.fictional.workNamePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fictional-genre">
              {t('questionnaire.basic.fictional.genre')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Input
              id="fictional-genre"
              value={data.fictionalGenre ?? ''}
              onChange={(e) => update('fictionalGenre', e.target.value)}
              placeholder={t('questionnaire.basic.fictional.genrePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fictional-bg">
              {t('questionnaire.basic.fictional.storyBackground')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="fictional-bg"
              value={data.fictionalStoryBackground ?? ''}
              onChange={(e) => update('fictionalStoryBackground', e.target.value)}
              placeholder={t('questionnaire.basic.fictional.storyBackgroundPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fictional-role">
              {t('questionnaire.basic.fictional.rolePosition')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Input
              id="fictional-role"
              value={data.fictionalRolePosition ?? ''}
              onChange={(e) => update('fictionalRolePosition', e.target.value)}
              placeholder={t('questionnaire.basic.fictional.rolePositionPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fictional-source">
              {t('questionnaire.basic.fictional.source')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Input
              id="fictional-source"
              value={data.fictionalSource ?? ''}
              onChange={(e) => update('fictionalSource', e.target.value)}
              placeholder={t('questionnaire.basic.fictional.sourcePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fictional-scene">
              {t('questionnaire.basic.fictional.sceneOrQuote')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="fictional-scene"
              value={data.fictionalSceneOrQuote ?? ''}
              onChange={(e) => update('fictionalSceneOrQuote', e.target.value)}
              placeholder={t('questionnaire.basic.fictional.sceneOrQuotePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
        </>
      )}

      {entityType === 'real_person' && (
        <>
          <Separator />
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-foreground">{t('questionnaire.basic.real.section')}</h4>
          </div>
          <div className="space-y-2">
            <Label htmlFor="real-purpose">
              {t('questionnaire.basic.real.purpose')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="real-purpose"
              value={data.realPersonPurpose ?? ''}
              onChange={(e) => update('realPersonPurpose', e.target.value)}
              placeholder={t('questionnaire.basic.real.purposePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="real-emotion">
              {t('questionnaire.basic.real.emotionalContext')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="real-emotion"
              value={data.realPersonEmotionalContext ?? ''}
              onChange={(e) => update('realPersonEmotionalContext', e.target.value)}
              placeholder={t('questionnaire.basic.real.emotionalContextPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="real-rel">
              {t('questionnaire.basic.real.relationshipToUser')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Input
              id="real-rel"
              value={data.realRelationshipToUser ?? ''}
              onChange={(e) => update('realRelationshipToUser', e.target.value)}
              placeholder={t('questionnaire.basic.real.relationshipToUserPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="real-stage">
              {t('questionnaire.basic.real.lifeStage')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Select
              value={data.realLifeStage ?? ''}
              onValueChange={(v) => update('realLifeStage', v)}
            >
              <SelectTrigger id="real-stage" className="bg-[hsl(var(--su-surface-2))]">
                <SelectValue placeholder={t('questionnaire.basic.real.lifeStage')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="present">{t('questionnaire.basic.real.lifeStage.present')}</SelectItem>
                <SelectItem value="departed">{t('questionnaire.basic.real.lifeStage.departed')}</SelectItem>
                <SelectItem value="memorial">{t('questionnaire.basic.real.lifeStage.memorial')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="real-intent">
              {t('questionnaire.basic.real.dialogueIntent')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="real-intent"
              value={data.realDialogueIntent ?? ''}
              onChange={(e) => update('realDialogueIntent', e.target.value)}
              placeholder={t('questionnaire.basic.real.dialogueIntentPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
        </>
      )}

      {entityType === 'custom' && (
        <>
          <Separator />
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-foreground">{t('questionnaire.basic.custom.section')}</h4>
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-purpose">
              {t('questionnaire.basic.custom.purpose')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="custom-purpose"
              value={data.customPurpose ?? ''}
              onChange={(e) => update('customPurpose', e.target.value)}
              placeholder={t('questionnaire.basic.custom.purposePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-world">
              {t('questionnaire.basic.custom.worldview')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="custom-world"
              value={data.customWorldview ?? ''}
              onChange={(e) => update('customWorldview', e.target.value)}
              placeholder={t('questionnaire.basic.custom.worldviewPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-role">
              {t('questionnaire.basic.custom.userRole')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Input
              id="custom-role"
              value={data.customUserRole ?? ''}
              onChange={(e) => update('customUserRole', e.target.value)}
              placeholder={t('questionnaire.basic.custom.userRolePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-proto">
              {t('questionnaire.basic.custom.prototypeNote')}{' '}
              <span className="text-muted-foreground font-normal">{t('questionnaire.optional')}</span>
            </Label>
            <Textarea
              id="custom-proto"
              value={data.customPrototypeNote ?? ''}
              onChange={(e) => update('customPrototypeNote', e.target.value)}
              placeholder={t('questionnaire.basic.custom.prototypeNotePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))] min-h-20"
            />
          </div>
        </>
      )}
    </div>
  );
}
