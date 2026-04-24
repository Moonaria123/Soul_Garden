'use client';

import { useEffect, useState } from 'react';
import { useEntityStore } from '@/lib/store/entity-store';
import { EntityCard } from '@/components/entity/entity-card';
import { Button } from '@/components/ui/button';
import { Plus, Flame } from 'lucide-react';
import { useT } from '@/lib/i18n';
import Link from 'next/link';

export default function HomePage() {
  const t = useT();
  const { entities, loadEntities } = useEntityStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntities().then(() => setLoading(false));
  }, [loadEntities]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Flame className="h-6 w-6 text-primary/60" style={{ animation: 'breathe 2.5s ease-in-out infinite' }} />
      </div>
    );
  }

  const isEmpty = entities.length === 0;

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-[family-name:var(--font-display)]">
            {t('home.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isEmpty
              ? t('home.empty.subtitle')
              : t('home.entityCount', { count: entities.length })}
          </p>
        </div>
        <Link href="/entities/new">
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1" /> {t('home.cta')}
          </Button>
        </Link>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
            <Flame className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <p className="text-lg text-foreground font-[family-name:var(--font-display)]">
              {t('home.empty.title')}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {t('home.empty.subtitle')}
            </p>
          </div>
          <Link href="/entities/new">
            <Button variant="outline" className="mt-2">
              <Plus className="h-4 w-4 mr-1" /> {t('home.empty.cta')}
            </Button>
          </Link>
        </div>
      )}

      {/* Entity grid */}
      {!isEmpty && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entities.map((entity) => (
            <EntityCard key={entity.id} entity={entity} />
          ))}
        </div>
      )}
    </div>
  );
}
