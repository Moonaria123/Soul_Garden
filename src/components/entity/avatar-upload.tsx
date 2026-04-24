'use client';

import type { ReactNode } from 'react';
import { useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { validateImageFile } from '@/lib/utils/image-validation';

interface AvatarUploadProps {
  avatarUrl?: string;
  name: string;
  size?: number;
  onUpload: (dataUrl: string) => void;
  onRemove?: () => void;
  className?: string;
  /** Extra line under the avatar with `avatar.uploadHint`. Default false — use Tooltip only (SU-ITER-047). */
  showHintBelow?: boolean;
  /**
   * When set, the hover Tooltip wraps both the avatar control and this node (e.g. name/title column),
   * so hovering either area shows the upload hint (SU-ITER-047).
   */
  tooltipAdjacent?: ReactNode;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const OUTPUT_SIZE = 256;

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // SU-ITER-090c · P2-08 NIT cleanup (mini-Gate SU-092 follow-up) —
    // revoke the object URL in both load/error paths to keep the Blob
    // GC-eligible; otherwise every avatar preview holds a reference
    // until the tab unloads, mirroring the chat-background leak that
    // P2-08 already fixed in `chat/page.tsx`.
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    };
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;
        // SU-ITER-092-batch3 · A4-MEDIUM — see chat/page.tsx sibling
        // for the same rationale: `getContext('2d')` can return null,
        // so we reject loudly instead of carrying an assertion.
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('canvas 2d context unavailable');
        }

        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

        resolve(canvas.toDataURL('image/webp', 0.8));
      } finally {
        cleanup();
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

export function AvatarUpload({
  avatarUrl,
  name,
  size = 48,
  onUpload,
  onRemove,
  className = '',
  showHintBelow = false,
  tooltipAdjacent,
}: AvatarUploadProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        toast.error(t('avatar.tooLarge'));
        if (inputRef.current) inputRef.current.value = '';
        return;
      }

      // SU-ITER-090a · P2-19 — MIME whitelist + magic-number validation.
      const v = await validateImageFile(file);
      if (!v.ok) {
        toast.error(t('avatar.invalidType'));
        if (inputRef.current) inputRef.current.value = '';
        return;
      }

      try {
        const dataUrl = await compressImage(file);
        onUpload(dataUrl);
      } catch {
        toast.error(t('avatar.uploadFailed'));
      }

      if (inputRef.current) inputRef.current.value = '';
    },
    [onUpload, t]
  );

  const avatarButton = (
    <button
      type="button"
      aria-label={t('avatar.uploadHint')}
      className="relative rounded-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
      style={{ width: size, height: size }}
      onClick={openFilePicker}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div
          className="w-full h-full bg-muted flex items-center justify-center text-primary font-bold font-[family-name:var(--font-display)]"
          style={{ fontSize: size * 0.4 }}
        >
          {name.charAt(0)}
        </div>
      )}
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <Camera className="text-white" style={{ width: size * 0.3, height: size * 0.3 }} />
      </div>
    </button>
  );

  const removeControl =
    avatarUrl && onRemove ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground h-auto py-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        {t('avatar.remove')}
      </Button>
    ) : null;

  const avatarColumn = (
    <span className="inline-flex flex-col items-center gap-1 shrink-0">
      {avatarButton}
      {removeControl}
    </span>
  );

  return (
    <div
      className={`group relative inline-flex gap-1 ${tooltipAdjacent ? 'items-start' : 'flex-col items-center'} ${className}`}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            {tooltipAdjacent ? (
              <span className="inline-flex items-start gap-3 min-w-0 cursor-default">
                {avatarColumn}
                {tooltipAdjacent}
              </span>
            ) : (
              avatarColumn
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[220px] text-center">
            {t('avatar.uploadHint')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showHintBelow && (
        <p className="text-[11px] text-muted-foreground text-center leading-snug max-w-[14rem] px-1">
          {t('avatar.uploadHint')}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        // SU-ITER-090a · P2-19 — narrow from `image/*` to the 4 formats
        // we actually decode + render.  Real validation happens in
        // handleFileChange via validateImageFile (byte signature).
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
