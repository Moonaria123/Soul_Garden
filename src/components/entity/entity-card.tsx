'use client';

import type { ConsciousnessEntity } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import Link from 'next/link';

interface EntityCardProps {
  entity: ConsciousnessEntity;
}

const STATUS_KEYS: Record<string, { key: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  ready: { key: 'entity.status.ready', variant: 'default' },
  draft: { key: 'entity.status.pending', variant: 'secondary' },
  extracting: { key: 'entity.status.extracting', variant: 'secondary' },
  error: { key: 'entity.status.failed', variant: 'destructive' },
};

const TYPE_KEYS: Record<string, string> = {
  fictional: 'entity.type.fictional',
  real_person: 'entity.type.real',
  custom: 'entity.type.custom',
};

export function EntityCard({ entity }: EntityCardProps) {
  const t = useT();
  const status = STATUS_KEYS[entity.status] || STATUS_KEYS.draft;
  const href = entity.status === 'ready'
    ? `/entities/${entity.id}/chat`
    : `/entities/${entity.id}`;

  return (
    <Link href={href}>
      <Card className="group relative overflow-hidden border-border bg-card hover:shadow-[var(--shadow-warm-md)] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
        <CardContent className="relative pt-6 pb-5 space-y-3">
          {/* Avatar */}
          <div className="flex items-center gap-3">
            <div className="relative">
              {entity.avatarUrl ? (
                <img
                  src={entity.avatarUrl}
                  alt={entity.name}
                  className="w-12 h-12 rounded-full object-cover"
                  style={{
                    animation: entity.status === 'ready' ? 'breathe 4s ease-in-out infinite' : undefined,
                  }}
                />
              ) : (
              <div
                className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-primary font-bold text-lg font-[family-name:var(--font-display)]"
                style={{
                  animation: entity.status === 'ready' ? 'breathe 4s ease-in-out infinite' : undefined,
                }}
              >
                {entity.name.charAt(0)}
              </div>
              )}
              {entity.status === 'ready' && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[hsl(var(--su-success))] border-2 border-card" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground truncate font-[family-name:var(--font-display)]">
                {entity.name}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t(TYPE_KEYS[entity.type] || 'entity.type.custom')}
              </p>
            </div>
          </div>

          {/* Status and actions */}
          <div className="flex items-center justify-between">
            <Badge variant={status.variant} className="text-[10px]">
              {t(status.key)}
            </Badge>
            {entity.status === 'ready' && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MessageCircle className="h-3 w-3" />
                <span>{t('entity.action.chat')}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
