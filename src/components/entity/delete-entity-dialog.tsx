'use client';

import { useState } from 'react';
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

interface DeleteEntityDialogProps {
  entityName: string;
  entityType?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function DeleteEntityDialog({
  entityName,
  entityType,
  open,
  onOpenChange,
  onConfirm,
}: DeleteEntityDialogProps) {
  const t = useT();
  const [deleting, setDeleting] = useState(false);

  const isDeceased = entityType === 'real_person';

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground font-[family-name:var(--font-display)]">
            {t('delete.title', { name: entityName })}
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-2">
            <p>
              {t('delete.message', { name: entityName })}
            </p>
            <p className="text-xs">
              {t('delete.warning')}
            </p>
            {isDeceased && (
              <p className="text-xs text-primary">
                {t('delete.realPersonNote')}
              </p>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t('delete.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? t('delete.confirming') : t('delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
