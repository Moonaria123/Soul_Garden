'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { BackupManifest, BackupScope } from '@/lib/backup/backup-format';
import type { RestoreStrategy, EntityRestoreStrategy } from '@/lib/backup/backup-restore';

interface RestoreConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: BackupManifest | null;
  showEntityStrategy?: boolean;
  showChatStrategy?: boolean;
  onConfirm: (opts: {
    chatStrategy?: RestoreStrategy;
    entityStrategy?: EntityRestoreStrategy;
  }) => void;
}

function scopeLabel(scope: BackupScope, t: (key: string) => string): string {
  switch (scope) {
    case 'chat-only': return t('backup.scope.configOnly').replace(/.*/, t('backup.chat.export'));
    case 'entity-full': return t('backup.entity.export');
    case 'all-entities': return t('backup.scope.allEntities');
    case 'config-only': return t('backup.scope.configOnly');
    case 'full': return t('backup.scope.full');
    default: return scope;
  }
}

export function RestoreConfirmDialog({
  open,
  onOpenChange,
  manifest,
  showEntityStrategy,
  showChatStrategy,
  onConfirm,
}: RestoreConfirmDialogProps) {
  const t = useT();
  const [chatStrategy, setChatStrategy] = useState<RestoreStrategy>('overwrite');
  const [entityStrategy, setEntityStrategy] = useState<EntityRestoreStrategy>('replace-existing');

  if (!manifest) return null;

  const date = manifest.createdAt
    ? new Date(manifest.createdAt).toLocaleString()
    : '—';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('backup.restore.confirm')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>{t('backup.restore.confirmMessage')}</p>
              <div className="rounded-md bg-muted px-3 py-2 space-y-1 text-xs">
                <p>{t('backup.backupDate', { date })}</p>
                <p>{t('backup.backupScope', { scope: scopeLabel(manifest.scope, t) })}</p>
                {manifest.stats?.entityCount != null && (
                  <p>{t('backup.backupEntities', { count: String(manifest.stats.entityCount) })}</p>
                )}
                {manifest.stats?.messageCount != null && (
                  <p>{t('backup.backupMessages', { count: String(manifest.stats.messageCount) })}</p>
                )}
                {manifest.encrypted && (
                  <p className="text-amber-600 dark:text-amber-400">{t('backup.apiKeyWarning')}</p>
                )}
              </div>

              {showChatStrategy && (
                <div className="space-y-2 pt-1">
                  <Label className="text-xs font-medium">{t('backup.restore.confirm')}</Label>
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="chatStrategy"
                        checked={chatStrategy === 'overwrite'}
                        onChange={() => setChatStrategy('overwrite')}
                        className="accent-primary"
                      />
                      {t('backup.restore.overwrite')}
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="chatStrategy"
                        checked={chatStrategy === 'merge'}
                        onChange={() => setChatStrategy('merge')}
                        className="accent-primary"
                      />
                      {t('backup.restore.merge')}
                    </label>
                  </div>
                </div>
              )}

              {showEntityStrategy && (
                <div className="space-y-2 pt-1">
                  <Label className="text-xs font-medium">{t('backup.restore.entityExists')}</Label>
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="entityStrategy"
                        checked={entityStrategy === 'replace-existing'}
                        onChange={() => setEntityStrategy('replace-existing')}
                        className="accent-primary"
                      />
                      {t('backup.restore.replaceExisting')}
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="entityStrategy"
                        checked={entityStrategy === 'create-new'}
                        onChange={() => setEntityStrategy('create-new')}
                        className="accent-primary"
                      />
                      {t('backup.restore.createNew')}
                    </label>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('backup.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onConfirm({
              chatStrategy: showChatStrategy ? chatStrategy : undefined,
              entityStrategy: showEntityStrategy ? entityStrategy : undefined,
            })}
          >
            {t('backup.restore.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
