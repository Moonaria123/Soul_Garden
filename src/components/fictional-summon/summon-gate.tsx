'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Wand2, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { WorkflowProgress, type WorkflowStep } from '@/components/ui/workflow-progress';
import { useT } from '@/lib/i18n';

interface SummonGateProps {
  onManualSummon: (name: string, workName: string) => void;
  onAutoSummon: (name: string, workName: string) => void;
  isAutoFilling: boolean;
  autoFillProgress?: string;
  autoFillError?: string;
  workflowSteps?: WorkflowStep[];
}

export function SummonGate({
  onManualSummon,
  onAutoSummon,
  isAutoFilling,
  autoFillProgress,
  autoFillError,
  workflowSteps,
}: SummonGateProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [workName, setWorkName] = useState('');

  const isValid = name.trim().length > 0;

  if (isAutoFilling) {
    return (
      <div className="space-y-6">
        <Card className="border-border bg-card shadow-[var(--shadow-warm-sm)]">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="relative">
                <Sparkles className="h-10 w-10 text-primary animate-pulse" />
                <div className="absolute -inset-2 bg-primary/5 rounded-full animate-ping" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-medium font-[family-name:var(--font-display)]">
                  {t('new.summonGate.autoFilling.title')}
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {autoFillProgress || t('new.summonGate.autoFilling.default')}
                </p>
              </div>
              <Loader2 className="h-5 w-5 animate-spin text-primary/60" />
              {workflowSteps && workflowSteps.length > 0 && (
                <WorkflowProgress steps={workflowSteps} />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-bold font-[family-name:var(--font-display)]">
          {t('new.summonGate.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('new.summonGate.subtitle')}
        </p>
      </div>

      <Card className="border-border bg-card shadow-[var(--shadow-warm-sm)]">
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="summon-name">
              {t('new.summonGate.nameLabel')} <span className="text-primary">*</span>
            </Label>
            <Input
              id="summon-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('new.summonGate.namePlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summon-work">
              {t('new.summonGate.workLabel')}
            </Label>
            <Input
              id="summon-work"
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              placeholder={t('new.summonGate.workPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>

          {autoFillError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-destructive">{autoFillError}</p>
                <p className="text-xs text-muted-foreground">
                  {t('new.summonGate.errorHint')}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2">
            <Button
              type="button"
              onClick={() => onManualSummon(name.trim(), workName.trim())}
              disabled={!isValid}
              variant="outline"
              className="w-full justify-center gap-2"
            >
              <Wand2 className="h-4 w-4" />
              {t('new.summonGate.manualBtn')}
            </Button>

            <Button
              type="button"
              onClick={() => onAutoSummon(name.trim(), workName.trim())}
              disabled={!isValid}
              className="w-full justify-center gap-2 shadow-[var(--shadow-warm-sm)]"
            >
              <Sparkles className="h-4 w-4" />
              {t('new.summonGate.autoBtn')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground/70 text-center">
            {t('new.summonGate.hint')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
