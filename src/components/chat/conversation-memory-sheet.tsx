'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useT } from '@/lib/i18n';
import * as dbClient from '@/lib/db/db-client';
import type {
  MemoryEventRow,
  MemoryFactRow,
  MemorySummaryRow,
  OpenLoopRow,
  RelationshipSnapshotRow,
} from '@/lib/db/db-client';
import { Loader2 } from 'lucide-react';

function relationshipSheetHasSignal(row: RelationshipSnapshotRow | null): boolean {
  if (!row) return false;
  return (
    row.affinityScore != null ||
    row.trustScore != null ||
    row.emotionalTemperature != null ||
    row.boundarySensitivity != null ||
    (row.preferredAddressingStyle != null && row.preferredAddressingStyle.trim() !== '')
  );
}

interface ConversationMemorySheetProps {
  entityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bump when chat changes so reopening refreshes (string or number). */
  refreshToken: string | number;
}

/**
 * Read-only timeline of dialogue-derived memory (FR-204).
 */
export function ConversationMemorySheet({
  entityId,
  open,
  onOpenChange,
  refreshToken,
}: ConversationMemorySheetProps) {
  const t = useT();
  const [events, setEvents] = useState<MemoryEventRow[]>([]);
  const [facts, setFacts] = useState<MemoryFactRow[]>([]);
  const [summaries, setSummaries] = useState<MemorySummaryRow[]>([]);
  const [openLoops, setOpenLoops] = useState<OpenLoopRow[]>([]);
  const [relationship, setRelationship] = useState<RelationshipSnapshotRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !entityId) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      dbClient.listMemoryEvents(entityId),
      dbClient.listMemoryFacts(entityId),
      dbClient.listMemorySummaries(entityId),
      dbClient.listOpenLoops(entityId),
      dbClient.getRelationshipSnapshot(entityId),
    ])
      .then(([ev, fa, su, loops, rel]) => {
        if (!cancelled) {
          const byTime = (a: { createdAt: string }, b: { createdAt: string }) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          setEvents([...ev].sort(byTime));
          setFacts([...fa].sort(byTime));
          setSummaries([...su].sort(byTime));
          setOpenLoops(
            [...loops].filter((l) => l.status === 'open').sort(byTime),
          );
          setRelationship(rel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
          setFacts([]);
          setSummaries([]);
          setOpenLoops([]);
          setRelationship(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entityId, refreshToken]);

  const empty =
    !loading &&
    events.length === 0 &&
    facts.length === 0 &&
    summaries.length === 0 &&
    openLoops.length === 0 &&
    !relationshipSheetHasSignal(relationship);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col bg-card border-border/60">
        <SheetHeader className="text-left shrink-0 space-y-1 pr-8">
          <SheetTitle className="font-[family-name:var(--font-display)] text-lg">
            {t('chat.memoryTimeline.title')}
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            {t('chat.memoryTimeline.readonly')}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 mt-4 -mr-2 pr-2">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('chat.loading')}
            </div>
          )}

          {empty && (
            <p className="text-sm text-muted-foreground leading-relaxed py-6 px-1">
              {t('chat.memoryTimeline.empty')}
            </p>
          )}

          {!loading && summaries.length > 0 && (
            <section className="mb-6 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.memoryTimeline.summaries')}
              </h3>
              <ul className="space-y-3">
                {summaries.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm leading-snug"
                  >
                    <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground mb-1">
                      <span>{s.summaryScope}</span>
                      <span>{new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                    <p>{s.summaryText}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && relationshipSheetHasSignal(relationship) && (
            <section className="mb-6 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.memoryTimeline.relationship')}
              </h3>
              <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                {relationship!.affinityScore != null && (
                  <p>亲和 {relationship!.affinityScore!.toFixed(2)}</p>
                )}
                {relationship!.trustScore != null && (
                  <p>信任 {relationship!.trustScore!.toFixed(2)}</p>
                )}
                {relationship!.emotionalTemperature != null && (
                  <p>情绪温度 {relationship!.emotionalTemperature!.toFixed(2)}</p>
                )}
                {relationship!.boundarySensitivity != null && (
                  <p>边界敏感 {relationship!.boundarySensitivity!.toFixed(2)}</p>
                )}
                {relationship!.preferredAddressingStyle?.trim() ? (
                  <p className="mt-1 text-foreground">
                    {t('chat.memoryTimeline.addressingStyle')}:{' '}
                    {relationship!.preferredAddressingStyle.trim()}
                  </p>
                ) : null}
              </div>
            </section>
          )}

          {!loading && openLoops.length > 0 && (
            <section className="mb-6 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.memoryTimeline.openLoops')}
              </h3>
              <ul className="space-y-3">
                {openLoops.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm leading-snug"
                  >
                    <span className="text-[10px] uppercase text-muted-foreground mr-2">
                      {l.loopType}
                    </span>
                    {l.topic}
                    {l.nextFollowupHint ? (
                      <p className="mt-1 text-xs text-muted-foreground">{l.nextFollowupHint}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && facts.length > 0 && (
            <section className="mb-6 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.memoryTimeline.facts')}
              </h3>
              <ul className="space-y-3">
                {facts.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm leading-snug"
                  >
                    <span className="text-[10px] uppercase text-muted-foreground mr-2">
                      {f.factType}
                    </span>
                    {f.statement}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && events.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('chat.memoryTimeline.events')}
              </h3>
              <ul className="space-y-3">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm leading-snug"
                  >
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground mb-1">
                      <span>{e.source}</span>
                      <span>{e.eventType}</span>
                      <span>{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <p>{e.summary}</p>
                    {e.quoteSnippet ? (
                      <p className="mt-1 text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                        {e.quoteSnippet}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
