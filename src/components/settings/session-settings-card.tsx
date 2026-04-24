'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useSessionSettingsStore } from '@/lib/store/session-settings-store';
import { SESSION_SETTINGS_LIMITS } from '@/types';

// ============================================================
// Session & Security Card (SU-087)
// Three controls: auto-logout switch, idle-timeout minutes, remember-tab
// Defaults: ON / 5 / OFF
// ============================================================

export function SessionSettingsCard() {
  const t = useT();
  const autoLogoutEnabled = useSessionSettingsStore((s) => s.autoLogoutEnabled);
  const idleTimeoutMinutes = useSessionSettingsStore((s) => s.idleTimeoutMinutes);
  const persistDEKThisTab = useSessionSettingsStore((s) => s.persistDEKThisTab);
  const isLoaded = useSessionSettingsStore((s) => s.isLoaded);
  const loadSettings = useSessionSettingsStore((s) => s.loadSettings);
  const saveSettings = useSessionSettingsStore((s) => s.saveSettings);

  const [minutesInput, setMinutesInput] = useState<string>(String(idleTimeoutMinutes));

  useEffect(() => {
    if (!isLoaded) {
      loadSettings().catch(() => {/* handled inside store */});
    }
  }, [isLoaded, loadSettings]);

  useEffect(() => {
    setMinutesInput(String(idleTimeoutMinutes));
  }, [idleTimeoutMinutes]);

  const persist = async (updates: Parameters<typeof saveSettings>[0]) => {
    try {
      await saveSettings(updates);
    } catch {
      toast.error(t('settings.session.saveFailed'));
    }
  };

  const handleToggleAutoLogout = (next: boolean) => {
    void persist({ autoLogoutEnabled: next });
  };

  const commitMinutes = () => {
    const n = parseInt(minutesInput, 10);
    const clamped = Math.max(
      SESSION_SETTINGS_LIMITS.idleTimeoutMinutesMin,
      Math.min(
        SESSION_SETTINGS_LIMITS.idleTimeoutMinutesMax,
        Number.isFinite(n) ? n : idleTimeoutMinutes,
      ),
    );
    if (clamped !== idleTimeoutMinutes) {
      void persist({ idleTimeoutMinutes: clamped });
    } else {
      setMinutesInput(String(clamped));
    }
  };

  const handleTogglePersistTab = (next: boolean) => {
    void persist({ persistDEKThisTab: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {t('settings.session.title')}
        </CardTitle>
        <CardDescription>{t('settings.session.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Auto logout switch */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium">
              {t('settings.session.autoLogout')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.session.autoLogoutHint')}
            </p>
          </div>
          <Switch
            checked={autoLogoutEnabled}
            onCheckedChange={handleToggleAutoLogout}
            aria-label={t('settings.session.autoLogout')}
          />
        </div>

        <Separator />

        {/* Idle timeout minutes */}
        <div className="space-y-2">
          <Label htmlFor="session-idle-minutes" className="text-sm font-medium">
            {t('settings.session.idleMinutes')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="session-idle-minutes"
              type="number"
              min={SESSION_SETTINGS_LIMITS.idleTimeoutMinutesMin}
              max={SESSION_SETTINGS_LIMITS.idleTimeoutMinutesMax}
              value={minutesInput}
              disabled={!autoLogoutEnabled}
              onChange={(e) => setMinutesInput(e.target.value)}
              onBlur={commitMinutes}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitMinutes();
                }
              }}
              className="max-w-[120px]"
            />
            <span className="text-sm text-muted-foreground">
              {t('settings.session.minutesUnit')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.session.idleMinutesHint')}
          </p>
        </div>

        <Separator />

        {/* Remember this tab */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium">
              {t('settings.session.persistTab')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.session.persistTabHint')}
            </p>
            {/* SU-ITER-090a · P2-03 — XSS residual-risk notice, shown only
                when the toggle is ON so we don't scare users who never
                enabled the feature. */}
            {persistDEKThisTab && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {t('settings.session.persistTabRisk')}
              </p>
            )}
          </div>
          <Switch
            checked={persistDEKThisTab}
            onCheckedChange={handleTogglePersistTab}
            aria-label={t('settings.session.persistTab')}
          />
        </div>
      </CardContent>
    </Card>
  );
}
