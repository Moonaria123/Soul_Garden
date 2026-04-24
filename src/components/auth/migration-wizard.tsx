'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store/auth-store';
import { useT } from '@/lib/i18n';
import {
  runMigrationV1ToV2,
  repairFalseMigratedMarker,
  restoreV1BackupOverActiveDb,
  closeSession,
  DbClientError,
  getMigrationStatus,
} from '@/lib/db/db-client';

// ============================================================
// MigrationWizard (SU-ITER-089 · P1-1 · B8-3)
//
// Opens automatically when a v1 on-disk database is detected at
// login time (server returns `migration_required` from /session/open).
// The auth-store stashes the already-verified credentials in
// `migrationRequirement`; this wizard drives the one-shot
// dump-and-restore upgrade and then replays `login()` so the user
// lands in the app as if the upgrade never happened.
//
// UX decisions (user-selected "C-plus" strategy):
//   * No extra password prompt — we already have it from the login
//     attempt that triggered the wizard.
//   * Modal is non-dismissable while the migration is running; all
//     in-flight buttons lose focus-grab and pointer-down-outside is
//     blocked (server migration is authoritative, interrupting it
//     would be fine because of atomic rename, but the UX guarantee
//     is "don't close this window").
//   * Success state shows row count + duration + reassurance that a
//     local backup exists, then offers a "Continue" button that
//     replays the original login.
// ============================================================

type WizardState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'success'; stats: { totalRows: number; durationMs: number } }
  | { kind: 'error'; messageKey: string; detail?: string };

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds - mins * 60);
  return `${mins} min ${rest} s`;
}

/**
 * Map structured migration errors from the server to the i18n key we
 * expose in the UI.  `state_conflict` with `detail === 'migrated'` is
 * handled in `handleStart` (auto login). Other `state_conflict` shapes
 * and `no_source_db` still map here — user can refresh or retry.
 */
function mapMigrationError(err: unknown): { messageKey: string; detail?: string } {
  if (err instanceof DbClientError) {
    switch (err.code) {
      case 'invalid_credentials':
        return { messageKey: 'auth.migration.error.code.invalid_credentials' };
      case 'account_not_found':
        return { messageKey: 'auth.migration.error.code.account_not_found' };
      case 'state_conflict':
      case 'no_source_db':
        return { messageKey: 'auth.migration.error.code.state_conflict' };
      case 'source_open_failed':
      case 'target_write_failed':
      case 'rename_failed':
      default:
        return {
          messageKey: 'auth.migration.error.code.generic',
          detail: err.code,
        };
    }
  }
  return {
    messageKey: 'auth.migration.error.code.generic',
    detail: err instanceof Error ? err.message : String(err),
  };
}

export function MigrationWizard() {
  const t = useT();
  const migrationRequirement = useAuthStore((s) => s.migrationRequirement);
  const clearMigrationRequirement = useAuthStore((s) => s.clearMigrationRequirement);
  const login = useAuthStore((s) => s.login);

  const [state, setState] = useState<WizardState>({ kind: 'idle' });
  const [hasV1Backup, setHasV1Backup] = useState(false);
  const handleStartRef = useRef<() => Promise<void>>(async () => {});
  const falseMigratedAutoRanRef = useRef(false);

  const open = migrationRequirement !== null;
  const username = migrationRequirement?.username ?? '';

  // Reset local state whenever the wizard is freshly opened.  We do
  // this via `useMemo` keyed on the requirement identity so React
  // resets synchronously before the first paint; a `useEffect` would
  // briefly flash the previous success/error UI.
  useMemo(() => {
    if (migrationRequirement) setState({ kind: 'idle' });
  }, [migrationRequirement]);

  useEffect(() => {
    if (!migrationRequirement) {
      setHasV1Backup(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await getMigrationStatus();
        if (!cancelled) setHasV1Backup(r.hasV1Backup);
      } catch {
        if (!cancelled) setHasV1Backup(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [migrationRequirement]);

  // Evict stale httpOnly DB session whenever the wizard opens so probes
  // and migration do not compete with a previous partial login.
  useEffect(() => {
    if (!migrationRequirement) return;
    void closeSession().catch(() => {});
  }, [migrationRequirement]);

  // Server already stripped a false `.db-v2-marker`; run v1→v2 once without
  // requiring an extra click (SU-093 migration deadlock UX).
  useEffect(() => {
    if (!migrationRequirement) {
      falseMigratedAutoRanRef.current = false;
      return;
    }
    if (migrationRequirement.openReason !== 'false_migrated_marker_removed_auto') {
      falseMigratedAutoRanRef.current = false;
      return;
    }
    if (falseMigratedAutoRanRef.current) return;
    falseMigratedAutoRanRef.current = true;
    void handleStartRef.current();
  }, [migrationRequirement]);

  const handleStart = async () => {
    if (!migrationRequirement) return;
    setState({ kind: 'running' });
    try {
      const result = await runMigrationV1ToV2(
        migrationRequirement.userId,
        migrationRequirement.password,
      );
      setState({
        kind: 'success',
        stats: {
          totalRows: result.stats.totalRows,
          durationMs: result.stats.durationMs,
        },
      });
    } catch (err) {
      // `state_conflict` / detail `migrated`: marker on disk but DB may still be v1
      // (false migrated). Try server-side repair (strip marker when v1 opens, v2 does not),
      // then re-run v1→v2. If disk is already true v2, repair says v2_already_openable → login.
      if (err instanceof DbClientError && err.code === 'state_conflict') {
        const detail = typeof err.data?.detail === 'string' ? err.data.detail : '';

        if (detail === 'migrated') {
          let repair: Awaited<ReturnType<typeof repairFalseMigratedMarker>>;
          try {
            repair = await repairFalseMigratedMarker(
              migrationRequirement.userId,
              migrationRequirement.password,
            );
          } catch (re) {
            const mapped = mapMigrationError(re);
            setState({ kind: 'error', ...mapped });
            return;
          }

          if (repair.ok) {
            try {
              const retry = await runMigrationV1ToV2(
                migrationRequirement.userId,
                migrationRequirement.password,
              );
              setState({
                kind: 'success',
                stats: {
                  totalRows: retry.stats.totalRows,
                  durationMs: retry.stats.durationMs,
                },
              });
              return;
            } catch (retryErr) {
              const mapped = mapMigrationError(retryErr);
              setState({ kind: 'error', ...mapped });
              return;
            }
          }

          if (!repair.ok && repair.reason === 'v2_already_openable') {
            const { username: u, password: p } = migrationRequirement;
            clearMigrationRequirement();
            // Evict any half-open server session so session/open is not
            // competing with a stale libsql handle (same-origin cookie).
            await closeSession().catch(() => {});
            await login(u, p);
            return;
          }

          if (!repair.ok) {
            const isV1Fail = repair.reason === 'v1_not_openable';
            setState({
              kind: 'error',
              messageKey: isV1Fail
                ? 'auth.migration.error.repair_v1_not_openable'
                : 'auth.migration.error.repair_failed',
              detail: [repair.reason, repair.detail].filter(Boolean).join(' — '),
            });
            return;
          }
        }

        let alreadyMigrated = false;
        if (detail === '') {
          try {
            const report = await getMigrationStatus();
            alreadyMigrated = report.state === 'migrated';
          } catch {
            /* ignore */
          }
        }
        if (alreadyMigrated) {
          const { username: u, password: p } = migrationRequirement;
          clearMigrationRequirement();
          await closeSession().catch(() => {});
          await login(u, p);
          return;
        }
      }
      const mapped = mapMigrationError(err);
      setState({ kind: 'error', ...mapped });
    }
  };

  handleStartRef.current = handleStart;

  const handleCancel = () => {
    if (state.kind === 'running') return;
    clearMigrationRequirement();
    setState({ kind: 'idle' });
  };

  const handleContinue = async () => {
    if (!migrationRequirement) return;
    const { username: u, password: p } = migrationRequirement;
    clearMigrationRequirement();
    await closeSession().catch(() => {});
    await login(u, p);
  };

  const handleRestoreFromV1Backup = async () => {
    if (!migrationRequirement) return;
    if (!window.confirm(t('auth.migration.restoreV1Bak.confirm'))) return;
    setState({ kind: 'running' });
    try {
      const res = await restoreV1BackupOverActiveDb(
        migrationRequirement.userId,
        migrationRequirement.password,
      );
      if (!res.ok) {
        setState({
          kind: 'error',
          messageKey: 'auth.migration.restoreV1Bak.error',
          detail: [res.reason, res.detail].filter(Boolean).join(' — '),
        });
        return;
      }
      const { username: u, password: p } = migrationRequirement;
      clearMigrationRequirement();
      await login(u, p);
    } catch (e) {
      const mapped = mapMigrationError(e);
      setState({ kind: 'error', ...mapped });
    }
  };

  const isRunning = state.kind === 'running';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => {
          if (isRunning) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isRunning) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {state.kind === 'success'
              ? t('auth.migration.success.title')
              : state.kind === 'error'
                ? t('auth.migration.error.title')
                : t('auth.migration.title')}
          </DialogTitle>
          <DialogDescription>
            {state.kind === 'idle' && t('auth.migration.subtitle', { username })}
            {state.kind === 'running' && t('auth.migration.progress.running')}
            {state.kind === 'success' &&
              t('auth.migration.success.body', {
                totalRows: state.stats.totalRows,
                duration: formatDuration(state.stats.durationMs),
              })}
            {state.kind === 'error' && t(state.messageKey)}
          </DialogDescription>
        </DialogHeader>

        {state.kind === 'idle' && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{t('auth.migration.intro')}</p>
            <p>{t('auth.migration.safety')}</p>
            <p>{t('auth.migration.duration')}</p>
            {hasV1Backup && (
              <p className="text-xs border-t border-border pt-3">{t('auth.migration.restoreV1Bak.hint')}</p>
            )}
          </div>
        )}

        {state.kind === 'running' && (
          <div className="flex items-center justify-center py-6">
            <div
              role="status"
              aria-label={t('auth.migration.progress.running')}
              className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
            />
          </div>
        )}

        {state.kind === 'error' && (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('auth.migration.error.contact')}</p>
            {state.detail && (
              <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">{state.detail}</pre>
            )}
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {state.kind === 'idle' && (
            <>
              <Button type="button" variant="outline" onClick={handleCancel}>
                {t('auth.migration.cancel')}
              </Button>
              <Button type="button" onClick={handleStart}>
                {t('auth.migration.start')}
              </Button>
              {hasV1Backup && (
                <Button
                  type="button"
                  variant="secondary"
                  className="sm:ml-0"
                  onClick={handleRestoreFromV1Backup}
                >
                  {t('auth.migration.restoreV1Bak.button')}
                </Button>
              )}
            </>
          )}
          {state.kind === 'running' && (
            <Button type="button" disabled>
              {t('auth.migration.progress.running')}
            </Button>
          )}
          {state.kind === 'error' && (
            <>
              <Button type="button" variant="outline" onClick={handleCancel}>
                {t('auth.migration.cancel')}
              </Button>
              <Button type="button" onClick={handleStart}>
                {t('auth.migration.error.retry')}
              </Button>
              {hasV1Backup && (
                <Button type="button" variant="secondary" onClick={handleRestoreFromV1Backup}>
                  {t('auth.migration.restoreV1Bak.button')}
                </Button>
              )}
            </>
          )}
          {state.kind === 'success' && (
            <Button type="button" onClick={handleContinue}>
              {t('auth.migration.success.continue')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
