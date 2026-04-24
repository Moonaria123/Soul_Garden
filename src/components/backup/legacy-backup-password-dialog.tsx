'use client';

// ============================================================
// SU-ITER-091-batch3 — V1 backup compatibility prompt.
//
// Legacy (v1-KDF-era) `.soul-backup` files were encrypted with a DEK
// derived from the user's **account password** through the buggy
// pre-migration PBKDF2 domain suffix.  A post-migration install's
// session DEK (v2 KDF) cannot decrypt them, so when
// `parseBackupPayload` sees `manifest.derivation.kdfVersion === 'v1'`
// it calls this dialog's provider to prompt the user for their
// password once.  The password is POSTed to
// `/api/db/backup/derive-legacy-dek` (rate-limited, Argon2id
// verified, account-locked on abuse), the server returns a one-shot
// v1 DEK hex, `decryptPayloadWithDekHex` uses it exactly once, and
// the reference is dropped.  The DEK never enters any store, cache,
// or session-storage slot — this is explicit in
// `backup-restore.ts#parseBackupPayload` and enforced server-side
// where no logging / caching touches `dekHex`.
//
// UX invariants:
//   - `userId` defaults to `currentUser.id` (hex UUID) pulled from
//     `useAuthStore`.  A power-user override field is shown in case
//     they are importing a backup that belongs to a different
//     account on the same install (rare but must work).
//   - Password field is `autocomplete="current-password"` and
//     `type="password"`; we don't offer "show" because the
//     sensitive material is re-entered in a modal, not kept around.
//   - Cancel resolves the provider to `null`, which
//     `parseBackupPayload` throws as `V1BackupPasswordRequiredError`
//     ("cancelled" branch) — keep the cancel affordance obvious so
//     users don't feel trapped.
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/lib/store/auth-store';
import type {
  LegacyPasswordProvider,
  LegacyPasswordProviderInput,
} from '@/lib/backup';

type PendingPrompt = {
  input: LegacyPasswordProviderInput;
  resolve: (value: { userId: string; password: string } | null) => void;
};

/**
 * Headless hook that returns a stable `LegacyPasswordProvider` plus
 * the JSX element to mount.  The caller wires the provider into
 * `parseBackupPayload(file, { legacyPasswordProvider })` and renders
 * `<dialog />` once somewhere in the restore surface.
 *
 * The provider is stable across renders (`useCallback`) so callers
 * can include it in a `useCallback` dep array without triggering
 * re-creation of the parent restore handler.
 */
export function useLegacyBackupPasswordPrompt(): {
  legacyPasswordProvider: LegacyPasswordProvider;
  dialog: React.ReactNode;
} {
  const t = useT();
  const currentUser = useAuthStore((s) => s.currentUser);

  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Track the active resolver so a parent unmount (or a second
  // prompt) never strands the previous promise in "pending" forever.
  const pendingRef = useRef<PendingPrompt | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    return () => {
      // Component unmount mid-prompt: resolve to null so the
      // upstream `parseBackupPayload` surfaces a clean cancellation
      // rather than an unresolved promise leak.
      if (pendingRef.current) {
        pendingRef.current.resolve(null);
        pendingRef.current = null;
      }
    };
  }, []);

  const legacyPasswordProvider = useCallback<LegacyPasswordProvider>(
    async (input) => {
      // Pre-fill userId from auth session when available — the
      // typical case is "same user upgraded from v1 to v2 on the
      // same install".  Override field below covers cross-account
      // imports.
      setUserId(currentUser?.id ?? '');
      setPassword('');
      setSubmitting(false);

      return new Promise<{ userId: string; password: string } | null>(
        (resolve) => {
          setPending({ input, resolve });
        },
      );
    },
    [currentUser?.id],
  );

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.resolve(null);
    setPending(null);
    setPassword('');
  }, [pending]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!pending || submitting) return;
      const trimmedUserId = userId.trim();
      if (!trimmedUserId || !password) return;
      setSubmitting(true);
      pending.resolve({ userId: trimmedUserId, password });
      setPending(null);
      // Best-effort: drop our copy of the password immediately.
      // `password` is a React state string and is immutable in JS
      // (see same caveat in backup-restore.ts), so GC reclaim is
      // the most we can guarantee here.
      setPassword('');
    },
    [pending, submitting, userId, password],
  );

  const isOpen = pending !== null;

  // Guard against `onOpenChange(false)` firing via radix outside
  // interactions (ESC / overlay click) — route them to the same
  // cancel path so `resolve(null)` still runs.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && pending) {
        handleCancel();
      }
    },
    [pending, handleCancel],
  );

  const dialog = (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          // Force users to use the Cancel button so they don't lose
          // the import state to an accidental outside click while
          // typing.  Still allow ESC via the default dialog path.
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('backup.restore.v1.title')}</DialogTitle>
          <DialogDescription>
            {t('backup.restore.v1.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="legacy-backup-userid" className="text-xs">
              {t('backup.restore.v1.userIdLabel')}
            </Label>
            <Input
              id="legacy-backup-userid"
              autoComplete="username"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder={t('backup.restore.v1.userIdPlaceholder')}
              disabled={submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              {t('backup.restore.v1.userIdHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="legacy-backup-password" className="text-xs">
              {t('backup.restore.v1.passwordLabel')}
            </Label>
            <Input
              id="legacy-backup-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={submitting}
            >
              {t('backup.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!userId.trim() || !password || submitting}
            >
              {t('backup.restore.v1.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { legacyPasswordProvider, dialog };
}
