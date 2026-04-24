'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, HardDriveDownload } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { toast } from 'sonner';
import type { ConsciousnessEntity } from '@/types';
import {
  serializeEntityPayload,
  createBackupZip,
  encryptPayload,
  downloadBackupFile,
  generateBackupFilename,
  APP_VERSION,
  BACKUP_FORMAT_VERSION,
} from '@/lib/backup';

interface BackupEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: ConsciousnessEntity;
}

export function BackupEntityDialog({ open, onOpenChange, entity }: BackupEntityDialogProps) {
  const t = useT();
  const [encrypting, setEncrypting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const { payload, stats } = await serializeEntityPayload(entity.id);
      let payloadJson = JSON.stringify(payload);

      if (encrypting) {
        payloadJson = await encryptPayload(payloadJson);
      }

      const blob = await createBackupZip(
        {
          version: BACKUP_FORMAT_VERSION,
          type: 'entity',
          scope: 'entity-full',
          appVersion: APP_VERSION,
          createdAt: new Date().toISOString(),
          entityId: entity.id,
          entityName: entity.name,
          encrypted: encrypting,
          stats,
        },
        payloadJson,
      );
      const filename = generateBackupFilename('entity', 'entity-full', entity.name);
      downloadBackupFile(blob, filename);
      toast.success(t('backup.exportSuccess'));
      onOpenChange(false);
    } catch (err) {
      toast.error(t('backup.restore.error', { error: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setIsExporting(false);
    }
  }, [entity, encrypting, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('backup.entity.export')}</DialogTitle>
          <DialogDescription>{t('backup.entity.includesProfile')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <p className="font-medium">{entity.name}</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="encrypt-toggle" className="text-sm">{t('backup.encrypt.label')}</Label>
              <p className="text-xs text-muted-foreground">{t('backup.encrypt.hint')}</p>
            </div>
            <Switch
              id="encrypt-toggle"
              checked={encrypting}
              onCheckedChange={setEncrypting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            {t('backup.cancel')}
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('backup.exporting')}
              </>
            ) : (
              <>
                <HardDriveDownload className="h-4 w-4 mr-2" />
                {t('backup.exportButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
