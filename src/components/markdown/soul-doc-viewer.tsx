'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Markdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Pencil, Save, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

// Dynamic import for MDEditor — SSR-unsafe (uses DOM APIs)
const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

interface SoulDocViewerProps {
  content: string;
  onSave?: (content: string) => void;
  readOnly?: boolean;
}

/**
 * Dual-mode soul doc viewer (SU-ITER-007):
 * - Rendered mode: Markdown parsed and beautifully rendered
 * - Edit mode: Full markdown editor with live preview
 */
export function SoulDocViewer({ content, onSave, readOnly }: SoulDocViewerProps) {
  const t = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);

  const handleEdit = useCallback(() => {
    setEditContent(content);
    setIsEditing(true);
  }, [content]);

  const handleCancel = useCallback(() => {
    setEditContent(content);
    setIsEditing(false);
  }, [content]);

  const handleSave = useCallback(() => {
    onSave?.(editContent);
    setIsEditing(false);
  }, [editContent, onSave]);

  if (!content && !isEditing) {
    return (
      <p className="text-muted-foreground text-sm italic">{t('soulDoc.notGenerated')}</p>
    );
  }

  if (isEditing) {
    return (
      <div className="space-y-3" data-color-mode="light">
        <MDEditor
          value={editContent}
          onChange={(val) => setEditContent(val || '')}
          height={400}
          preview="live"
          visibleDragbar={false}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="h-3.5 w-3.5 mr-1" /> {t('soulDoc.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="h-3.5 w-3.5 mr-1" /> {t('soulDoc.save')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      {!readOnly && onSave && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
          onClick={handleEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      <div className="prose prose-sm max-w-none prose-headings:font-[family-name:var(--font-display)] prose-headings:text-foreground prose-strong:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-code:text-foreground prose-pre:bg-[hsl(var(--su-surface-2))]">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}
