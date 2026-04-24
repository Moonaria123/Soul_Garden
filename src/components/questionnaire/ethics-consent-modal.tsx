'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface EthicsConsentModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EthicsConsentModal({
  open,
  onConfirm,
  onCancel,
}: EthicsConsentModalProps) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md border-border bg-card"
      >
        <DialogHeader>
          <DialogTitle className="text-lg text-foreground font-[family-name:var(--font-display)]">
            {t('ethics.modal.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('ethics.modal.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {t('ethics.modal.intro')}
          </p>

          <ul className="space-y-3">
            <li className="flex gap-3 text-sm">
              <span className="mt-0.5 text-primary">
                &#x2022;
              </span>
              <span className="text-foreground">
                {t('ethics.modal.item1')}
              </span>
            </li>
            <li className="flex gap-3 text-sm">
              <span className="mt-0.5 text-primary">
                &#x2022;
              </span>
              <span className="text-foreground">
                {t('ethics.modal.item2')}
              </span>
            </li>
            <li className="flex gap-3 text-sm">
              <span className="mt-0.5 text-primary">
                &#x2022;
              </span>
              <span className="text-foreground">
                {t('ethics.modal.item3')}
              </span>
            </li>
            <li className="flex gap-3 text-sm">
              <span className="mt-0.5 text-primary">
                &#x2022;
              </span>
              <span className="text-foreground">
                {t('ethics.modal.item4')}
              </span>
            </li>
          </ul>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={onConfirm}
            className="w-full"
          >
            {t('ethics.modal.confirm')}
          </Button>
          <Button
            variant="ghost"
            onClick={onCancel}
            className="w-full text-muted-foreground"
          >
            {t('ethics.modal.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
