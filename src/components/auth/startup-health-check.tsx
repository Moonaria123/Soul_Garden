'use client';

import { useCallback, useEffect, useState } from 'react';
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
import {
  getMigrationStatus,
  recoverFromBakOnly,
  recoverFromRekeyBak,
  cleanupV1Backup,
  cleanupRekeyBackup,
  DbClientError,
  type MigrationStatusReport,
} from '@/lib/db/db-client';

// ============================================================
// StartupHealthCheck (SU-ITER-089 · P1-1 · B8-8)
//
// Mounted on the unauthenticated layout; runs one `migration/status`
// probe when the auth surface paints and routes on the result:
//
//   * `bak-only` — the rare crash-window state where the `.db` file
//     is missing but `.bak-v1` survived (rename 2 committed, rename 3
//     did not).  Surfaces a NON-DISMISSABLE dialog with a single
//     "recover" action because the app cannot proceed otherwise.
//
//   * `migrated` + `hasV1Backup` or `hasRekeyBackup` — everything is
//     fine, but the user can reclaim disk by removing the historical
//     backup.  Surfaces a lightweight banner with "clean up" and
//     "keep" actions; "keep" hides the prompt for the rest of the
//     browser session (sessionStorage flag).
//
// The component intentionally stays silent for `fresh`, `migrated`
// without backups, and `needs-migration` (MigrationWizard handles
// that) so it never competes with the main flow.
// ============================================================

const SESSION_HIDE_V1_KEY = 'su-hide-bak-v1-banner';
const SESSION_HIDE_REKEY_KEY = 'su-hide-bak-rekey-banner';

type RecoveryState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; detail?: string };

export function StartupHealthCheck() {
  const t = useT();
  const [report, setReport] = useState<MigrationStatusReport | null>(null);
  const [hideV1Session, setHideV1Session] = useState(false);
  const [hideRekeySession, setHideRekeySession] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryState>({ kind: 'idle' });
  const [cleanupBusy, setCleanupBusy] = useState<null | 'v1' | 'rekey'>(null);

  // Hydrate sessionStorage dismissals on mount — this has to happen
  // inside an effect so SSR doesn't try to read `window`.
  useEffect(() => {
    try {
      setHideV1Session(sessionStorage.getItem(SESSION_HIDE_V1_KEY) === '1');
      setHideRekeySession(sessionStorage.getItem(SESSION_HIDE_REKEY_KEY) === '1');
    } catch {
      // sessionStorage unavailable (SSR / privacy mode) — treat as not hidden.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await getMigrationStatus();
      setReport(r);
    } catch (err) {
      // A failed status probe is noisy but not actionable for the user
      // at the auth surface — log and keep going so the main flow
      // isn't blocked.
      console.warn('[startup-health-check] status probe failed:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRecover = async () => {
    setRecovery({ kind: 'running' });
    try {
      await recoverFromBakOnly();
      setRecovery({ kind: 'idle' });
      await refresh();
    } catch (err) {
      const detail = err instanceof DbClientError ? err.code : err instanceof Error ? err.message : String(err);
      setRecovery({ kind: 'error', detail });
    }
  };

  const handleRecoverRekey = async () => {
    setRecovery({ kind: 'running' });
    try {
      await recoverFromRekeyBak();
      setRecovery({ kind: 'idle' });
      await refresh();
    } catch (err) {
      const detail = err instanceof DbClientError ? err.code : err instanceof Error ? err.message : String(err);
      setRecovery({ kind: 'error', detail });
    }
  };

  const handleCleanupV1 = async () => {
    setCleanupBusy('v1');
    try {
      await cleanupV1Backup();
      await refresh();
    } catch (err) {
      console.warn('[startup-health-check] cleanup v1 failed:', err);
    } finally {
      setCleanupBusy(null);
    }
  };

  const handleCleanupRekey = async () => {
    setCleanupBusy('rekey');
    try {
      await cleanupRekeyBackup();
      await refresh();
    } catch (err) {
      console.warn('[startup-health-check] cleanup rekey failed:', err);
    } finally {
      setCleanupBusy(null);
    }
  };

  const dismissV1 = () => {
    try { sessionStorage.setItem(SESSION_HIDE_V1_KEY, '1'); } catch { /* ignore */ }
    setHideV1Session(true);
  };

  const dismissRekey = () => {
    try { sessionStorage.setItem(SESSION_HIDE_REKEY_KEY, '1'); } catch { /* ignore */ }
    setHideRekeySession(true);
  };

  if (!report) return null;

  // -----------------------------------------------------------------
  // Forced-recovery path: bak-only / rekey-bak-only are blocking — no
  // other UI can run until the user acknowledges.  We swallow the
  // MigrationWizard entirely by rendering ourselves before it in the
  // layout tree.
  //
  // The two branches share the same dialog shell; only the i18n
  // namespace and recovery handler differ.  `rekey-bak-only` was added
  // 2026-04-19 (Stage B Gate · code-C-2 / sec-C-2) to handle the
  // change-password double-failure window where the active .db was
  // unlinked but the bak-rekey → .db rollback rename did not complete.
  // -----------------------------------------------------------------
  if (report.state === 'bak-only' || report.state === 'rekey-bak-only') {
    const ns = report.state === 'bak-only'
      ? 'auth.recovery.bakOnly'
      : 'auth.recovery.rekeyBakOnly';
    const onRecover = report.state === 'bak-only' ? handleRecover : handleRecoverRekey;
    return (
      <Dialog open>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t(`${ns}.title`)}</DialogTitle>
            <DialogDescription>{t(`${ns}.description`)}</DialogDescription>
          </DialogHeader>
          {recovery.kind === 'error' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {t(`${ns}.errorGeneric`)}
              {recovery.detail && (
                <code className="ml-2 text-xs opacity-80">{recovery.detail}</code>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={onRecover}
              disabled={recovery.kind === 'running'}
            >
              {recovery.kind === 'running'
                ? t(`${ns}.recovering`)
                : t(`${ns}.recover`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // -----------------------------------------------------------------
  // Optional cleanup banners: only when the db is confirmed v2 and
  // at least one backup lingers.  If both are present we stack the
  // v1 banner on top (older, more important to clean) followed by
  // the rekey banner.  Each respects its own session-hide flag.
  // -----------------------------------------------------------------
  if (report.state !== 'migrated') return null;

  const showV1 = report.hasV1Backup && !hideV1Session;
  const showRekey = report.hasRekeyBackup && !hideRekeySession;
  if (!showV1 && !showRekey) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
        {showV1 && (
          <BackupCleanupCard
            title={t('auth.cleanup.v1.title')}
            description={t('auth.cleanup.v1.description')}
            primaryLabel={t('auth.cleanup.v1.primary')}
            secondaryLabel={t('auth.cleanup.v1.secondary')}
            onPrimary={handleCleanupV1}
            onSecondary={dismissV1}
            busy={cleanupBusy === 'v1'}
          />
        )}
        {showRekey && (
          <BackupCleanupCard
            title={t('auth.cleanup.rekey.title')}
            description={t('auth.cleanup.rekey.description')}
            primaryLabel={t('auth.cleanup.rekey.primary')}
            secondaryLabel={t('auth.cleanup.rekey.secondary')}
            onPrimary={handleCleanupRekey}
            onSecondary={dismissRekey}
            busy={cleanupBusy === 'rekey'}
          />
        )}
      </div>
    </div>
  );
}

interface BackupCleanupCardProps {
  title: string;
  description: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  busy: boolean;
}

function BackupCleanupCard({
  title,
  description,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  busy,
}: BackupCleanupCardProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/95 p-4 shadow-lg backdrop-blur">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onSecondary} disabled={busy}>
          {secondaryLabel}
        </Button>
        <Button size="sm" onClick={onPrimary} disabled={busy}>
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
