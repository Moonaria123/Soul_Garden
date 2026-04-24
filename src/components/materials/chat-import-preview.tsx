'use client';

import type { ParsedChatHistory } from '@/lib/parsers/chat-parser-types';
import type { IMPlatform } from '@/lib/parsers/chat-parser-types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Calendar, AlertTriangle, Users, Check } from 'lucide-react';
import { useT } from '@/lib/i18n';

const PLATFORM_DISPLAY: Record<IMPlatform, { label: string; color: string }> = {
  wechat: { label: 'WeChat', color: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  qq: { label: 'QQ', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  feishu: { label: 'Feishu', color: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' },
  dingtalk: { label: 'DingTalk', color: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  whatsapp: { label: 'WhatsApp', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  unknown: { label: 'Chat', color: 'bg-muted text-muted-foreground' },
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

interface ChatImportPreviewProps {
  parsed: ParsedChatHistory;
  selectedSpeakers: string[];
  onSelectedSpeakersChange: (speakers: string[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChatImportPreview({
  parsed,
  selectedSpeakers,
  onSelectedSpeakersChange,
  onConfirm,
  onCancel,
}: ChatImportPreviewProps) {
  const t = useT();

  const platformInfo = PLATFORM_DISPLAY[parsed.platform];
  const speakerMsgCounts = new Map<string, number>();
  for (const msg of parsed.messages) {
    if (msg.type !== 'system') {
      speakerMsgCounts.set(msg.sender, (speakerMsgCounts.get(msg.sender) ?? 0) + 1);
    }
  }

  const toggleSpeaker = (speaker: string) => {
    if (selectedSpeakers.includes(speaker)) {
      onSelectedSpeakersChange(selectedSpeakers.filter((s) => s !== speaker));
    } else {
      onSelectedSpeakersChange([...selectedSpeakers, speaker]);
    }
  };

  const lowMessageCount = parsed.metadata.totalParsed < 10;

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 space-y-4">
        {/* Platform badge + stats */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`${platformInfo.color} border-0`}>
            {platformInfo.label}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {parsed.format.toUpperCase()}
          </Badge>
        </div>

        {/* Message count + time range */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            {t('chatImport.preview.messageCount', { count: String(parsed.metadata.totalParsed) })}
          </span>
          {parsed.timeRange.earliest && parsed.timeRange.latest && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(parsed.timeRange.earliest)} ~ {formatDate(parsed.timeRange.latest)}
            </span>
          )}
        </div>

        {/* Low message warning */}
        {lowMessageCount && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>{t('chatImport.preview.lowCount')}</p>
          </div>
        )}

        {/* Speaker selection */}
        {parsed.participants.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{t('chatImport.preview.speakerHint')}</span>
            </div>
            <div className="space-y-1.5">
              {parsed.participants.map((speaker) => {
                const isChecked = selectedSpeakers.includes(speaker);
                return (
                  <button
                    key={speaker}
                    type="button"
                    onClick={() => toggleSpeaker(speaker)}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors w-full text-left"
                  >
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0 ${
                        isChecked
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-border'
                      }`}
                    >
                      {isChecked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">{speaker}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {speakerMsgCounts.get(speaker) ?? 0} {t('chatImport.preview.messages')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Warnings */}
        {parsed.metadata.warnings.length > 0 && (
          <div className="text-[11px] text-muted-foreground space-y-1">
            {parsed.metadata.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                {w}
              </p>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={onConfirm}
            disabled={selectedSpeakers.length === 0}
            className="flex-1"
          >
            {t('chatImport.preview.confirm')}
          </Button>
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            {t('chatImport.preview.cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
