'use client';

import { useState, useCallback, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  className?: string;
}

export function TagInput({
  tags,
  onChange,
  placeholder,
  maxTags,
  className,
}: TagInputProps) {
  const t = useT();
  const [inputValue, setInputValue] = useState('');

  const addTag = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (tags.includes(trimmed)) return;
      if (maxTags && tags.length >= maxTags) return;
      onChange([...tags, trimmed]);
      setInputValue('');
    },
    [tags, onChange, maxTags]
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(inputValue);
      } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
        removeTag(tags.length - 1);
      }
    },
    [inputValue, addTag, removeTag, tags.length]
  );

  const isAtMax = maxTags !== undefined && tags.length >= maxTags;

  return (
    <div className={cn('space-y-2', className)}>
      {/* Tags display */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, index) => (
            <Badge
              key={`${tag}-${index}`}
              variant="secondary"
              className="gap-1 pr-1 text-sm border-border bg-[hsl(var(--su-secondary-highlight))] text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(index)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-background/60 transition-colors"
                aria-label={t('tagInput.remove', { tag })}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input */}
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isAtMax
            ? t('tagInput.maxReached', { max: maxTags ?? '' })
            : placeholder ?? t('tagInput.placeholder')
        }
        disabled={isAtMax}
        className="bg-[hsl(var(--su-surface-2))]"
      />

      {maxTags && (
        <p className="text-xs text-muted-foreground">
          {tags.length}/{maxTags}
        </p>
      )}
    </div>
  );
}
