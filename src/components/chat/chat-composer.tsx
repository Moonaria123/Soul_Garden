'use client';

// SU-088 P0-F: extracted from (main)/entities/[id]/chat/page.tsx.
// Bottom input bar: voice toggle + textarea + send button.

import { forwardRef } from 'react';
import type { ConsciousnessEntity } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, MicOff, Send } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface ChatComposerProps {
  input: string;
  onInputChange: (next: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  isStreaming: boolean;
  hasSpeechAPI: boolean;
  isListening: boolean;
  onToggleVoice: () => void;
  entity: ConsciousnessEntity | null;
}

export const ChatComposer = forwardRef<HTMLTextAreaElement, ChatComposerProps>(
  function ChatComposer(
    {
      input,
      onInputChange,
      onKeyDown,
      onSend,
      isStreaming,
      hasSpeechAPI,
      isListening,
      onToggleVoice,
      entity,
    },
    ref,
  ) {
    const t = useT();

    return (
      <div className="border-t border-border/50 bg-card/50 backdrop-blur-sm p-4 relative z-10 shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2">
          {hasSpeechAPI && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleVoice}
              className={isListening ? 'bg-accent text-accent-foreground' : ''}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}
          <Textarea
            ref={ref}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={entity ? t('chat.placeholder', { name: entity.name }) : t('chat.loading')}
            className="min-h-[40px] max-h-32 resize-none bg-[hsl(var(--su-surface-2))]"
            rows={1}
            disabled={isStreaming}
          />
          <Button onClick={onSend} disabled={!input.trim() || isStreaming} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-muted-foreground">
          {t('chat.disclaimer')}
        </p>
      </div>
    );
  },
);
