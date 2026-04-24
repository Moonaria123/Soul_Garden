'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ConsciousnessEntity } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BookOpen } from 'lucide-react';
import { AvatarUpload } from './avatar-upload';
import { useT } from '@/lib/i18n';
import { toast } from 'sonner';
import Link from 'next/link';

interface EntityProfileDialogProps {
  entity: ConsciousnessEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAvatarChange?: (dataUrl: string) => void;
  onAvatarRemove?: () => void;
  onEntityUpdate?: (updates: Partial<ConsciousnessEntity>) => Promise<void>;
}

const TYPE_KEYS: Record<string, string> = {
  fictional: 'entity.type.fictional',
  real_person: 'entity.type.real',
  custom: 'entity.type.custom',
};

/** SU-ITER-055: only ♂/♀ for recognized male/female; any other value (incl. non-binary, empty, free text) → ? */
function genderIcon(gender: string): '♂' | '♀' | '?' {
  const g = gender.trim();
  if (!g) return '?';
  const lower = g.toLowerCase();
  if (lower === '男' || lower === 'male' || lower === 'm' || lower === '男性') return '♂';
  if (lower === '女' || lower === 'female' || lower === 'f' || lower === '女性') return '♀';
  return '?';
}

function genderColor(icon: '♂' | '♀' | '?'): string {
  if (icon === '♂') return 'text-blue-500';
  if (icon === '♀') return 'text-pink-500';
  return 'text-muted-foreground';
}

export function EntityProfileDialog({
  entity,
  open,
  onOpenChange,
  onAvatarChange,
  onAvatarRemove,
  onEntityUpdate,
}: EntityProfileDialogProps) {
  const t = useT();

  const s1 = entity.questionnaire.step1;
  const s4 = entity.questionnaire.step4;
  const gIcon = genderIcon(s1.gender ?? '');
  const genderIconTitle =
    s1.gender?.trim() || t('profile.genderNotSpecified');

  const [informalNickname, setInformalNickname] = useState('');
  const [region, setRegion] = useState('');
  const [userCallName, setUserCallName] = useState('');

  useEffect(() => {
    if (!open) return;
    setInformalNickname(s1.informalNickname ?? '');
    setRegion(s1.region ?? '');
    setUserCallName(s4.userCallName ?? '');
  }, [open, entity.id, s1.informalNickname, s1.region, s4.userCallName]);

  const saveField = useCallback(
    async (path: 'step1' | 'step4', key: 'informalNickname' | 'region' | 'userCallName', value: string) => {
      if (!onEntityUpdate) return;
      const prev =
        path === 'step1'
          ? key === 'informalNickname'
            ? (s1.informalNickname ?? '')
            : (s1.region ?? '')
          : (s4.userCallName ?? '');
      if (value.trim() === prev.trim()) return;

      const q = { ...entity.questionnaire };
      if (path === 'step1') {
        q.step1 = { ...q.step1, [key]: value };
      } else {
        q.step4 = { ...q.step4, userCallName: value };
      }
      await onEntityUpdate({ questionnaire: q });
      toast.success(t('profile.editSaved'));
    },
    [entity.questionnaire, onEntityUpdate, s1.informalNickname, s1.region, s4.userCallName, t]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <AvatarUpload
            avatarUrl={entity.avatarUrl}
            name={entity.name}
            size={80}
            onUpload={(url) => onAvatarChange?.(url)}
            onRemove={onAvatarRemove}
            className="mb-2"
          />
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl flex items-center justify-center gap-1.5">
            {entity.name}
            <span className={`text-base ${genderColor(gIcon)}`} title={genderIconTitle}>
              {gIcon}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Badge variant="outline" className="text-xs">
              {t(TYPE_KEYS[entity.type] || 'entity.type.custom')}
            </Badge>
          </div>

          {s4.relationshipType && (
            <p className="text-sm text-muted-foreground text-center">
              {s4.relationshipType}
              {s4.interactionMode ? ` · ${s4.interactionMode}` : ''}
            </p>
          )}

          <div className="space-y-3 pt-1 border-t border-border/50 text-left">
            <div className="space-y-1.5">
              <Label htmlFor="profile-informal-nickname" className="text-xs text-muted-foreground">
                {t('profile.nickname')}
              </Label>
              <Input
                id="profile-informal-nickname"
                value={informalNickname}
                onChange={(e) => setInformalNickname(e.target.value)}
                placeholder={t('profile.nicknamePlaceholder')}
                className="h-9 text-sm bg-[hsl(var(--su-surface-2))]"
                onBlur={() => saveField('step1', 'informalNickname', informalNickname.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-region" className="text-xs text-muted-foreground">
                {t('profile.region')}
              </Label>
              <Input
                id="profile-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder={t('profile.regionPlaceholder')}
                className="h-9 text-sm bg-[hsl(var(--su-surface-2))]"
                onBlur={() => saveField('step1', 'region', region.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-user-call-name" className="text-xs text-muted-foreground">
                {t('profile.userCallName')}
              </Label>
              <Input
                id="profile-user-call-name"
                value={userCallName}
                onChange={(e) => setUserCallName(e.target.value)}
                placeholder={t('profile.userCallNamePlaceholder')}
                className="h-9 text-sm bg-[hsl(var(--su-surface-2))]"
                onBlur={() => saveField('step4', 'userCallName', userCallName.trim())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <p className="text-[11px] text-muted-foreground/70">{t('profile.userCallNameHint')}</p>
            </div>
          </div>

          <div className="flex justify-center pt-1">
            <Link href={`/entities/${entity.id}`} onClick={() => onOpenChange(false)}>
              <Button variant="outline" size="sm">
                <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                {t('profile.viewArchive')}
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
