'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import { useSessionSettingsStore } from '@/lib/store/session-settings-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

// Warning fires at min(60s, 20% of total timeout) before auto-logout.
function computeWarningMs(timeoutMs: number): number {
  return Math.min(60_000, Math.max(5_000, Math.floor(timeoutMs * 0.2)));
}

export function IdleTimeoutProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { isAuthenticated, logout } = useAuthStore();
  const autoLogoutEnabled = useSessionSettingsStore((s) => s.autoLogoutEnabled);
  const idleTimeoutMinutes = useSessionSettingsStore((s) => s.idleTimeoutMinutes);
  const settingsLoaded = useSessionSettingsStore((s) => s.isLoaded);
  const loadSettings = useSessionSettingsStore((s) => s.loadSettings);

  const [showWarning, setShowWarning] = useState(false);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ensure settings are loaded once authenticated.
  useEffect(() => {
    if (isAuthenticated && !settingsLoaded) {
      loadSettings().catch((e) => console.warn('[idle] loadSettings failed', e));
    }
  }, [isAuthenticated, settingsLoaded, loadSettings]);

  const timeoutMs = Math.max(60_000, idleTimeoutMinutes * 60_000);
  const warningMs = computeWarningMs(timeoutMs);

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const resetTimers = useCallback(() => {
    if (!isAuthenticated || !autoLogoutEnabled) return;

    try {
      sessionStorage.setItem('su_lastActivity', Date.now().toString());
    } catch {
      /* noop */
    }

    clearAllTimers();
    setShowWarning(false);

    const showWarningAfter = Math.max(0, timeoutMs - warningMs);
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
    }, showWarningAfter);

    logoutTimerRef.current = setTimeout(() => {
      setShowWarning(false);
      logout();
    }, timeoutMs);
  }, [isAuthenticated, autoLogoutEnabled, timeoutMs, warningMs, logout, clearAllTimers]);

  useEffect(() => {
    // Not authenticated or auto-logout disabled → no timers, no listeners.
    if (!isAuthenticated || !autoLogoutEnabled) {
      clearAllTimers();
      setShowWarning(false);
      return;
    }

    // Check if already timed out (e.g., tab was backgrounded).
    try {
      const lastActivity = sessionStorage.getItem('su_lastActivity');
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed >= timeoutMs) {
          logout();
          return;
        }
      }
    } catch {
      /* noop */
    }

    resetTimers();

    const handler = () => resetTimers();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handler, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handler);
      }
      clearAllTimers();
    };
  }, [
    isAuthenticated,
    autoLogoutEnabled,
    timeoutMs,
    resetTimers,
    clearAllTimers,
    logout,
  ]);

  const handleStayLoggedIn = () => {
    resetTimers();
  };

  const idleMinutesLabel = String(idleTimeoutMinutes);

  return (
    <>
      {children}
      <Dialog open={showWarning} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t('session.idle.title')}</DialogTitle>
            <DialogDescription>
              {t('session.idle.description', { minutes: idleMinutesLabel })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setShowWarning(false); logout(); }}>
              {t('session.idle.logoutNow')}
            </Button>
            <Button onClick={handleStayLoggedIn}>
              {t('session.idle.continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
