'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ConsciousnessEntity, ChatSession } from '@/types';
import { exportOpenClawZip, generateOpenClawPrompt } from '@/lib/utils/openclaw-export';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sparkles,
  FolderOpen,
  Download,
  Copy,
  Check,
  ArrowRight,
  Heart,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useChatStore } from '@/lib/store/chat-store';

interface OpenClawDialogProps {
  entity: ConsciousnessEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_PATH = '~/.openclaw/';

export function OpenClawDialog({ entity, open, onOpenChange }: OpenClawDialogProps) {
  const t = useT();
  const [targetPath, setTargetPath] = useState(DEFAULT_PATH);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptGenerated, setPromptGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);

  const { loadOrCreateSession } = useChatStore();

  useEffect(() => {
    if (open && entity) {
      loadOrCreateSession(entity.id).then((session) => {
        if (session && session.messages.length > 0) {
          setChatSession(session);
        } else {
          setChatSession(null);
        }
      });
    }
  }, [open, entity, loadOrCreateSession]);

  useEffect(() => {
    if (!open) {
      setExported(false);
      setPrompt('');
      setPromptGenerated(false);
      setCopied(false);
    }
  }, [open]);

  const handleExport = useCallback(async () => {
    if (!targetPath.trim()) {
      toast.error(t('openclaw.pathRequired'));
      return;
    }

    setExporting(true);
    try {
      await exportOpenClawZip(entity, chatSession, targetPath.trim());
      setExported(true);
      toast.success(t('openclaw.exportSuccess', { name: entity.name }));
    } catch (_err) {
      toast.error(t('openclaw.exportError'));
    } finally {
      setExporting(false);
    }
  }, [entity, chatSession, targetPath, t]);

  const handleGeneratePrompt = useCallback(() => {
    if (!targetPath.trim()) {
      toast.error(t('openclaw.pathRequired'));
      return;
    }

    const hasHistory = (chatSession?.messages?.length ?? 0) > 0;
    const generatedPrompt = generateOpenClawPrompt(entity, targetPath.trim(), hasHistory);
    setPrompt(generatedPrompt);
    setPromptGenerated(true);
  }, [entity, chatSession, targetPath, t]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success(t('openclaw.promptCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('openclaw.copyFailed'));
    }
  }, [prompt, t]);

  const messageCount = chatSession?.messages?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground font-[family-name:var(--font-display)]">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('openclaw.title', { name: entity.name })}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t('openclaw.description', { name: entity.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Step 1: Set path */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">
                1
              </div>
              <Label className="text-sm font-medium">{t('openclaw.stepPath')}</Label>
            </div>
            <p className="text-xs text-muted-foreground pl-8">
              {t('openclaw.stepPathHint')}
            </p>
            <div className="pl-8 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder={DEFAULT_PATH}
                className="text-sm"
              />
            </div>
          </div>

          <Separator />

          {/* Step 2: Export docs */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">
                2
              </div>
              <Label className="text-sm font-medium">{t('openclaw.stepExport')}</Label>
            </div>
            <p className="text-xs text-muted-foreground pl-8">
              {t('openclaw.stepExportHint', { name: entity.name })}
            </p>
            {messageCount > 0 && (
              <p className="text-xs text-muted-foreground pl-8 flex items-center gap-1">
                <Heart className="h-3 w-3" />
                {t('openclaw.includesConversation', { count: String(messageCount) })}
              </p>
            )}
            <div className="pl-8">
              <Button
                onClick={handleExport}
                disabled={exporting || !targetPath.trim()}
                className="shadow-[var(--shadow-warm-sm)]"
                variant={exported ? 'outline' : 'default'}
              >
                {exported ? (
                  <>
                    <Check className="h-4 w-4 mr-1.5" />
                    {t('openclaw.exported')}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-1.5" />
                    {exporting ? t('openclaw.exporting') : t('openclaw.exportButton')}
                  </>
                )}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Step 3: Generate prompt */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">
                3
              </div>
              <Label className="text-sm font-medium">{t('openclaw.stepPrompt')}</Label>
            </div>
            <p className="text-xs text-muted-foreground pl-8">
              {t('openclaw.stepPromptHint')}
            </p>
            <div className="pl-8 space-y-3">
              {!promptGenerated ? (
                <Button
                  onClick={handleGeneratePrompt}
                  disabled={!targetPath.trim()}
                  variant="outline"
                >
                  <Sparkles className="h-4 w-4 mr-1.5" />
                  {t('openclaw.generatePrompt')}
                </Button>
              ) : (
                <>
                  <div className="relative rounded-lg border border-border bg-[hsl(var(--su-surface-2))] p-3">
                    <pre className="text-xs text-foreground whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
                      {prompt}
                    </pre>
                  </div>
                  <Button
                    onClick={handleCopy}
                    className="shadow-[var(--shadow-warm-sm)]"
                    size="sm"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        {t('openclaw.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        {t('openclaw.copyPrompt')}
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Guidance footer */}
          <div className="rounded-lg bg-[hsl(var(--su-primary-highlight))] p-3 space-y-2">
            <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
              {t('openclaw.nextSteps')}
            </p>
            <ol className="text-xs text-muted-foreground space-y-1 pl-5 list-decimal">
              <li>{t('openclaw.nextStep1')}</li>
              <li>{t('openclaw.nextStep2')}</li>
              <li>{t('openclaw.nextStep3', { name: entity.name })}</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
