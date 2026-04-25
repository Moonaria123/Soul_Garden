'use client';

import { Heart, Handshake, Sparkles, UserRound, Users } from 'lucide-react';
import type { RelationshipSnapshotRow } from '@/lib/db/db-client';
import {
  relationshipTierLabelKey,
  resolveRelationshipTier,
  type RelationshipTierLevel,
} from '@/lib/relationship/resolve-tier';
import { useT } from '@/lib/i18n';

const TIER_ICONS: Record<RelationshipTierLevel, typeof Heart> = {
  1: UserRound,
  2: Users,
  3: Handshake,
  4: Heart,
  5: Sparkles,
};

export function RelationshipTierBadge({
  snapshot,
  userGender,
  entityGender,
  className = '',
  compact = false,
}: {
  snapshot: RelationshipSnapshotRow | null;
  userGender?: string | null;
  entityGender?: string | null;
  className?: string;
  /** Smaller icon-only friendly layout */
  compact?: boolean;
}) {
  const t = useT();
  const tier = resolveRelationshipTier(snapshot);
  const labelKey = relationshipTierLabelKey(tier, userGender, entityGender);
  const label = t(labelKey);
  const Icon = TIER_ICONS[tier];

  return (
    <div
      className={`inline-flex items-center gap-1.5 text-muted-foreground ${className}`}
      title={label}
      aria-label={label}
    >
      <Icon className={`shrink-0 text-primary/80 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} aria-hidden />
      {!compact ? <span className="text-xs font-medium text-foreground/90 truncate max-w-[10rem]">{label}</span> : null}
    </div>
  );
}
