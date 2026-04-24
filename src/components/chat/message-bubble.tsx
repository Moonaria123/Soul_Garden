'use client';

// SU-088 P0-F: extracted from (main)/entities/[id]/chat/page.tsx.
// One message row (user or assistant) with hover actions.

import type { ChatMessage, ConsciousnessEntity, UserProfile } from '@/types';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function MessageBubble({
  msg,
  entity,
  userProfile,
  locale,
  onShowProfile,
  onRequestDelete,
}: {
  msg: ChatMessage;
  entity: ConsciousnessEntity | null;
  userProfile: UserProfile | null;
  locale: string;
  onShowProfile: () => void;
  onRequestDelete: (id: string) => void;
}) {
  const t = useT();

  return (
    <div
      className={`group flex items-end gap-2 ${
        msg.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      {msg.role === 'assistant' && (
        <button
          type="button"
          onClick={onShowProfile}
          className="flex-shrink-0 mb-1 rounded-full outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          title={t('profile.title')}
          aria-label={t('profile.title')}
        >
          {entity?.avatarUrl ? (
            <img
              src={entity.avatarUrl}
              alt=""
              className="w-8 h-8 rounded-full object-cover pointer-events-none"
            />
          ) : (
            <div className="pointer-events-none w-8 h-8 rounded-full bg-muted flex items-center justify-center text-primary font-bold text-xs font-[family-name:var(--font-display)]">
              {entity?.name?.charAt(0) || '·'}
            </div>
          )}
        </button>
      )}

      <div
        className={`flex items-center gap-1 ${
          msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        <div
          className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
            msg.role === 'user'
              ? 'bg-accent text-accent-foreground rounded-tr-md shadow-[var(--shadow-warm-sm)]'
              : 'bg-[hsl(var(--su-surface-2))] border border-border text-foreground rounded-tl-md shadow-[var(--shadow-warm-sm)]'
          }`}
        >
          <p className="whitespace-pre-wrap">{msg.content}</p>
          <p
            className={`text-[10px] mt-1 ${
              msg.role === 'user'
                ? 'text-accent-foreground/50'
                : 'text-muted-foreground/50'
            }`}
          >
            {new Date(msg.timestamp).toLocaleTimeString(locale, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-muted flex-shrink-0"
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={msg.role === 'user' ? 'end' : 'start'}
            className="min-w-[120px]"
          >
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard.writeText(msg.content);
                toast.success(t('chat.copyMessage.done'));
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-2" />
              {t('chat.copyMessage')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onRequestDelete(msg.id)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              {t('chat.deleteMessage')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {msg.role === 'user' && (
        <Link
          href="/me"
          className="flex-shrink-0 mb-1 rounded-full outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          title={t('nav.me')}
          aria-label={t('nav.me')}
        >
          {userProfile?.avatarUrl ? (
            <img
              src={userProfile.avatarUrl}
              alt=""
              className="w-8 h-8 rounded-full object-cover pointer-events-none"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent/60 flex items-center justify-center text-accent-foreground font-bold text-xs pointer-events-none">
              {userProfile?.displayName?.charAt(0) ||
                userProfile?.nickname?.charAt(0) ||
                '我'}
            </div>
          )}
        </Link>
      )}
    </div>
  );
}
