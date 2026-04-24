'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, HardDriveUpload, Upload } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { toast } from 'sonner';
import * as dbClient from '@/lib/db/db-client';
import {
  validateBackup,
  parseBackupPayload,
  restoreEntityPayload,
  V1BackupPasswordRequiredError,
  V1BackupDeriveFailedError,
  type BackupManifest,
  type EntityRestoreStrategy,
  type EntityBackupPayload,
} from '@/lib/backup';
import { useLegacyBackupPasswordPrompt } from '@/components/backup/legacy-backup-password-dialog';

interface RestoreEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestoreComplete: () => void;
}

export function RestoreEntityDialog({ open, onOpenChange, onRestoreComplete }: RestoreEntityDialogProps) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [entityExists, setEntityExists] = useState(false);
  const [strategy, setStrategy] = useState<EntityRestoreStrategy>('replace-existing');
  const [isRestoring, setIsRestoring] = useState(false);

  // SU-ITER-091-batch3 — V1 backup compatibility.  Same provider
  // plumbing as `BackupSettingsCard` / chat page; no-op for v2 files.
  const { legacyPasswordProvider, dialog: legacyBackupDialog } =
    useLegacyBackupPasswordPrompt();

  const reset = useCallback(() => {
    setSelectedFile(null);
    setManifest(null);
    setEntityExists(false);
    setStrategy('replace-existing');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await validateBackup(file);
      if (!result.valid) {
        toast.error(result.error || t('backup.restore.invalidFile'));
        return;
      }
      // SU-ITER-091-batch1 mini-Gate · Concern-2 cleanup — guard used
      // to be `&&`, which accepted any file that matched EITHER `type`
      // OR `scope`.  A crafted `.soul-backup` with `type='chat'` +
      // `scope='entity-full'` would then slip through and `restoreEntityPayload`
      // would read a non-existent `payload.chat.sessions` in
      // `remapEntityIds`, throwing *after* `create-new` had already
      // rotated IDs (low impact) or worse, *during* `replace-existing`
      // once the atomic delete branch had run.  Switching to `||`
      // means both facets must match before the dialog opens.
      if (result.manifest.type !== 'entity' || result.manifest.scope !== 'entity-full') {
        toast.error(t('backup.restore.typeMismatch'));
        return;
      }

      setSelectedFile(file);
      setManifest(result.manifest);

      if (result.manifest.entityId) {
        const existing = await dbClient.getEntity(result.manifest.entityId);
        setEntityExists(!!existing);
      }
    } catch {
      toast.error(t('backup.restore.invalidFile'));
    }
  }, [t]);

  const handleRestore = useCallback(async () => {
    if (!selectedFile) return;
    setIsRestoring(true);
    try {
      const { payload } = await parseBackupPayload(selectedFile, {
        legacyPasswordProvider,
      });
      // SU-ITER-091-batch1 · code-N-5 — entity backup flow; scope
      // validated upstream via `validateBackup`.
      await restoreEntityPayload(payload as EntityBackupPayload, strategy);
      toast.success(t('backup.restore.success'));
      onOpenChange(false);
      reset();
      onRestoreComplete();
    } catch (err) {
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
      setIsRestoring(false);
    }
  }, [selectedFile, strategy, onOpenChange, onRestoreComplete, reset, t, legacyPasswordProvider]);

  const handleClose = useCallback((v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  }, [onOpenChange, reset]);

  const date = manifest?.createdAt
    ? new Date(manifest.createdAt).toLocaleString()
    : null;

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('backup.entity.import')}</DialogTitle>
          <DialogDescription>{t('backup.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!manifest ? (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 cursor-pointer hover:border-muted-foreground/40 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t('backup.dropHint')}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".soul-backup"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md bg-muted px-3 py-2 space-y-1 text-sm">
                {manifest.entityName && (
                  <p className="font-medium">{manifest.entityName}</p>
                )}
                {date && <p className="text-xs text-muted-foreground">{t('backup.backupDate', { date })}</p>}
                {manifest.stats?.messageCount != null && (
                  <p className="text-xs text-muted-foreground">
                    {t('backup.backupMessages', { count: String(manifest.stats.messageCount) })}
                  </p>
                )}
                {manifest.encrypted && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t('backup.apiKeyWarning')}</p>
                )}
              </div>

              {entityExists && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('backup.restore.entityExists')}</p>
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="entityStrategy"
                        checked={strategy === 'replace-existing'}
                        onChange={() => setStrategy('replace-existing')}
                        className="accent-primary"
                      />
                      {t('backup.restore.replaceExisting')}
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="entityStrategy"
                        checked={strategy === 'create-new'}
                        onChange={() => setStrategy('create-new')}
                        className="accent-primary"
                      />
                      {t('backup.restore.createNew')}
                    </label>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {t('backup.restore.confirmMessage')}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isRestoring}>
            {t('backup.cancel')}
          </Button>
          {manifest && (
            <Button onClick={handleRestore} disabled={isRestoring}>
              {isRestoring ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('backup.importing')}
                </>
              ) : (
                <>
                  <HardDriveUpload className="h-4 w-4 mr-2" />
                  {t('backup.restore.confirm')}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {/* SU-ITER-091-batch3 — mounted alongside so parseBackupPayload
        can open it via the provider when a v1 entity backup is
        detected. */}
    {legacyBackupDialog}
    </>
  );
}
