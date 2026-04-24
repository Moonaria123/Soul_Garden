'use client';

import type { TextMaterial } from '@/types';
import type { IMPlatform } from '@/lib/parsers/chat-parser-types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, X } from 'lucide-react';
import { formatFileSize, formatCharCount } from '@/lib/parsers/text-parser';
import { useT } from '@/lib/i18n';

const PLATFORM_PATTERNS: { pattern: RegExp; platform: IMPlatform; label: string; color: string }[] = [
  { pattern: /^WeChat/i, platform: 'wechat', label: 'WeChat', color: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  { pattern: /^QQ/i, platform: 'qq', label: 'QQ', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  { pattern: /^Feishu/i, platform: 'feishu', label: 'Feishu', color: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' },
  { pattern: /^DingTalk/i, platform: 'dingtalk', label: 'DingTalk', color: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  { pattern: /^WhatsApp/i, platform: 'whatsapp', label: 'WhatsApp', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
];

function detectPlatformFromFilename(filename: string) {
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(filename)) return p;
  }
  return null;
}

interface ChatMaterialBadgeProps {
  material: TextMaterial;
  onRemove?: () => void;
}

export function ChatMaterialBadge({ material, onRemove }: ChatMaterialBadgeProps) {
  const t = useT();
  const platformInfo = detectPlatformFromFilename(material.filename);

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--su-primary-highlight))] flex items-center justify-center shrink-0">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {platformInfo && (
              <Badge className={`${platformInfo.color} border-0 text-[9px] px-1.5 py-0`}>
                {platformInfo.label}
              </Badge>
            )}
            <p className="text-sm font-medium text-foreground truncate">{material.filename}</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{formatFileSize(material.fileSize)}</span>
            <span>·</span>
            <span>{formatCharCount(material.charCount)} {t('materials.chars')}</span>
          </div>
        </div>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
