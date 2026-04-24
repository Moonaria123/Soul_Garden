'use client';

import { useState } from 'react';
import type { ConsciousnessEntity, SoulDocKeyV1 } from '@/types';
import { SOUL_DOC_KEYS_V1 } from '@/types';
import { exportEntityZip, exportSingleDoc } from '@/lib/utils/export';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, FileText, Archive } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface ExportDialogProps {
  entity: ConsciousnessEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ entity, open, onOpenChange }: ExportDialogProps) {
  const t = useT();
  const [exporting, setExporting] = useState(false);

  const docLabelKey: Record<SoulDocKeyV1, string> = {
    SOUL: 'soulDoc.SOUL',
    VOICE: 'soulDoc.VOICE',
    EMOTIONAL_PATTERNS: 'soulDoc.EMOTIONAL_PATTERNS',
    MEMORY: 'soulDoc.MEMORY',
    RELATIONSHIP: 'soulDoc.RELATIONSHIP',
  };

  const handleExportZip = async () => {
    setExporting(true);
    try {
      await exportEntityZip(entity.name, entity.soulDocs, entity.textMaterials, entity.chatMaterials);
    } finally {
      setExporting(false);
      onOpenChange(false);
    }
  };

  const handleExportSingle = (key: SoulDocKeyV1) => {
    if (!entity.soulDocs[key]) return;
    exportSingleDoc(entity.name, key, entity.soulDocs[key]);
  };

  const availableDocs = SOUL_DOC_KEYS_V1.filter((key) => entity.soulDocs[key]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground font-[family-name:var(--font-display)]">
            {t('export.title', { name: entity.name })}
          </DialogTitle>
          <DialogDescription>
            {t('export.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ZIP export */}
          <Button
            onClick={handleExportZip}
            disabled={exporting || availableDocs.length === 0}
            className="h-auto w-full justify-start gap-3 border-border bg-[hsl(var(--su-primary-highlight))] py-3 text-foreground hover:bg-[hsl(var(--accent))]"
            variant="outline"
          >
            <Archive className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-medium">{t('export.downloadAll')}</p>
              <p className="text-xs text-muted-foreground">
                {t('export.docCount', { count: availableDocs.length })}
              </p>
            </div>
          </Button>

          {/* Individual docs */}
          {availableDocs.length > 0 && (
            <div className="space-y-1.5">
              <p className="px-1 text-xs text-muted-foreground">{t('export.individual')}</p>
              {availableDocs.map((key) => (
                <Button
                  key={key}
                  onClick={() => handleExportSingle(key)}
                  variant="ghost"
                  className="w-full justify-start gap-3 h-auto py-2.5"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="text-left">
                    <p className="text-sm">{t(docLabelKey[key])}</p>
                    <p className="text-[10px] text-muted-foreground">{key}.md</p>
                  </div>
                  <Download className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
                </Button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
