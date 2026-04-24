'use client';

import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { HardDriveDownload, Upload, Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import {
  serializeConfigPayload,
  serializeAllEntitiesPayload,
  serializeFullPayload,
  createBackupZip,
  encryptPayload,
  downloadBackupFile,
  generateBackupFilename,
  validateBackup,
  parseBackupPayload,
  restoreConfigPayload,
  restoreFullPayload,
  APP_VERSION,
  BACKUP_FORMAT_VERSION,
  V1BackupPasswordRequiredError,
  V1BackupDeriveFailedError,
  type BackupScope,
  type BackupManifest,
  type BackupProgressPhase,
  type BackupStats,
  type ConfigBackupPayload,
  type GlobalBackupPayload,
} from '@/lib/backup';
import { RestoreConfirmDialog } from '@/components/backup/restore-confirm-dialog';
import { useLegacyBackupPasswordPrompt } from '@/components/backup/legacy-backup-password-dialog';

export function BackupSettingsCard() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const [encrypting, setEncrypting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingScope, setExportingScope] = useState<BackupScope | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<BackupManifest | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // SU-ITER-091-batch3 — V1 backup password prompt.  The hook returns
  // a stable provider so including it in the handler dep array below
  // does not cause re-creation on every render.
  const { legacyPasswordProvider, dialog: legacyBackupDialog } =
    useLegacyBackupPasswordPrompt();

  const handleProgress = useCallback((phase: BackupProgressPhase, current: number, total: number) => {
    if (total > 0) {
      setProgressPercent(Math.round((current / total) * 100));
    }
    setProgressLabel(phase);
  }, []);

  const handleExport = useCallback(async (scope: BackupScope) => {
    setIsExporting(true);
    setExportingScope(scope);
    setProgressPercent(0);
    try {
      let payloadJson: string;
      let stats: BackupStats;

      if (scope === 'config-only') {
        const result = await serializeConfigPayload();
        payloadJson = JSON.stringify(result.payload);
        stats = result.stats;
      } else if (scope === 'all-entities') {
        const result = await serializeAllEntitiesPayload(handleProgress);
        payloadJson = JSON.stringify(result.payload);
        stats = result.stats;
      } else {
        const result = await serializeFullPayload(handleProgress);
        payloadJson = JSON.stringify(result.payload);
        stats = result.stats;
      }

      if (encrypting) {
        setProgressLabel('encrypting');
        payloadJson = await encryptPayload(payloadJson);
      }

      setProgressLabel('compressing');
      const blob = await createBackupZip(
        {
          version: BACKUP_FORMAT_VERSION,
          type: 'global',
          scope,
          appVersion: APP_VERSION,
          createdAt: new Date().toISOString(),
          encrypted: encrypting,
          stats,
        },
        payloadJson,
      );
      const filename = generateBackupFilename('global', scope);
      downloadBackupFile(blob, filename);
      toast.success(t('backup.exportSuccess'));
    } catch (err) {
      toast.error(t('backup.restore.error', { error: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setIsExporting(false);
      setExportingScope(null);
      setProgressPercent(0);
      setProgressLabel('');
    }
  }, [encrypting, handleProgress, t]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateBackup(file);
      if (!result.valid) {
        toast.error(result.error || t('backup.restore.invalidFile'));
        return;
      }
      if (result.manifest.type !== 'global') {
        toast.error(t('backup.restore.typeMismatch'));
        return;
      }
      setRestoreFile(file);
      setRestoreManifest(result.manifest);
      setShowRestoreConfirm(true);
    } catch {
      toast.error(t('backup.restore.invalidFile'));
    }
    if (fileRef.current) fileRef.current.value = '';
  }, [t]);

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoreFile || !restoreManifest) return;
    setShowRestoreConfirm(false);
    setIsImporting(true);
    setProgressPercent(0);
    try {
      // SU-ITER-091-batch3 — wire the V1 backup password prompt so
      // legacy (pre-migration) backups can still be restored on a
      // post-migration install.  The provider is a no-op for v2
      // backups — `parseBackupPayload` only calls it when the
      // manifest's `derivation.kdfVersion === 'v1'`.
      const { payload } = await parseBackupPayload(restoreFile, {
        legacyPasswordProvider,
      });

      // SU-ITER-091-batch1 · code-N-5 — `parseBackupPayload` now
      // returns the `AnyBackupPayload` union; narrow against the
      // manifest scope we already validated above so the typed
      // `restoreConfigPayload` / `restoreFullPayload` receive exactly
      // the shape they expect.
      if (restoreManifest.scope === 'config-only') {
        await restoreConfigPayload(payload as ConfigBackupPayload);
      } else {
        await restoreFullPayload(payload as GlobalBackupPayload, 'replace-existing', handleProgress);
      }

      toast.success(t('backup.restore.success'));
    } catch (err) {
      // SU-ITER-091-batch3 — route typed V1 compatibility errors to
      // dedicated i18n keys so the user gets actionable messaging
      // (cancelled / wrong password / rate limited / locked) rather
      // than a generic decrypt failure toast.
      if (err instanceof V1BackupPasswordRequiredError) {
        toast.info(t('backup.restore.v1.cancelled'));
      } else if (err instanceof V1BackupDeriveFailedError) {
        const code = err.code;
        if (code === 'invalid_credentials') {
          toast.error(t('backup.restore.v1.invalidCredentials'));
        } else if (code === 'rate_limited') {
          toast.error(t('backup.restore.v1.rateLimited'));
        } else if (code === 'account_locked') {
          toast.error(t('backup.restore.v1.accountLocked'));
        } else {
          toast.error(t('backup.restore.v1.deriveFailed', { code }));
        }
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('Decryption') || msg.includes('decrypt')) {
          toast.error(t('backup.restore.decryptFailed'));
        } else {
          toast.error(t('backup.restore.error', { error: msg }));
        }
      }
    } finally {
      setIsImporting(false);
      setRestoreFile(null);
      setRestoreManifest(null);
      setProgressPercent(0);
      setProgressLabel('');
    }
  }, [restoreFile, restoreManifest, handleProgress, t, legacyPasswordProvider]);

  const busy = isExporting || isImporting;

  return (
    <>
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" /> {t('backup.settings.title')}
          </CardTitle>
          <CardDescription>{t('backup.settings.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Encrypt toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="settings-encrypt" className="text-sm">{t('backup.encrypt.label')}</Label>
              <p className="text-xs text-muted-foreground max-w-sm">{t('backup.encrypt.hint')}</p>
            </div>
            <Switch
              id="settings-encrypt"
              checked={encrypting}
              onCheckedChange={setEncrypting}
              disabled={busy}
            />
          </div>

          <Separator />

          {/* Export buttons */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t('backup.exportButton')}</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => handleExport('all-entities')}
              >
                {exportingScope === 'all-entities' ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t('backup.scope.allEntities')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => handleExport('config-only')}
              >
                {exportingScope === 'config-only' ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t('backup.scope.configOnly')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => handleExport('full')}
              >
                {exportingScope === 'full' ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t('backup.scope.full')}
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          {busy && (
            <div className="space-y-1.5">
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {isExporting ? t('backup.exporting') : t('backup.importing')}
                {progressLabel ? ` (${progressLabel})` : ''}
              </p>
            </div>
          )}

          <Separator />

          {/* Import */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t('backup.importButton')}</Label>
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 cursor-pointer hover:border-muted-foreground/40 transition-colors"
              onClick={() => !busy && fileRef.current?.click()}
            >
              {isImporting ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground/50" />
              )}
              <p className="text-xs text-muted-foreground">{t('backup.dropHint')}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".soul-backup"
                className="hidden"
                onChange={handleFileSelect}
                disabled={busy}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <RestoreConfirmDialog
        open={showRestoreConfirm}
        onOpenChange={setShowRestoreConfirm}
        manifest={restoreManifest}
        onConfirm={handleRestoreConfirm}
      />
      {/* SU-ITER-091-batch3 — mounted so parseBackupPayload can open
          it via the provider when a v1 backup is detected. */}
      {legacyBackupDialog}
    </>
  );
}
