'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import { deriveEncryptionKey, setDEK } from '@/lib/crypto';
import { setReUnlockResolver } from '@/lib/crypto/reunlock';
import { openSession, DbClientError } from '@/lib/db/db-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';

// ============================================================
// ReUnlockDialog (SU-087)
// Registers itself as the re-unlock resolver. When DEK-requiring code
// calls requireDEK() and no DEK is active, this dialog opens, asks
// the user for their password, re-derives the DEK via PBKDF2 on the
// stored salt, and resolves the pending promise.
// ============================================================

interface PendingRequest {
  resolve: (key: CryptoKey | null) => void;
}

export function ReUnlockDialog() {
  const t = useT();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pendingRef = useRef<PendingRequest | null>(null);

  useEffect(() => {
    setReUnlockResolver(() => {
      return new Promise<CryptoKey | null>((resolve) => {
        pendingRef.current = { resolve };
        setPassword('');
        setError(null);
        setOpen(true);
      });
    });
    return () => {
      setReUnlockResolver(null);
    };
  }, []);

  const finish = (key: CryptoKey | null) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    setPassword('');
    setError(null);
    setSubmitting(false);
    pending?.resolve(key);
  };

  const handleCancel = () => {
    finish(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    if (!currentUser) {
      setError(t('auth.reunlock.noUser'));
      return;
    }
    if (!password) {
      setError(t('auth.reunlock.wrongPassword'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // SU-ITER-089 · P1-1 · B8-6: re-unlock now piggybacks on session/open,
      // which already performs an identical password verify + lockout
      // progression and returns `salt` so we can derive the Client KEK.
      // This collapses two near-identical verify paths into one — better
      // for auditing and avoids lockout-state divergence (see the
      // deprecation note on reunlockAccount in db-client.ts).
      //
      // Side-effect: the server-side DB session is also re-opened, which
      // is strictly a consistency win — the client KEK and the DB DEK
      // now come back into sync even if they had drifted.
      const { salt } = await openSession(currentUser.id, password);
      const key = await deriveEncryptionKey(password, salt);
      await setDEK(key);
      finish(key);
    } catch (err) {
      if (err instanceof DbClientError && err.code === 'account_locked') {
        setError(t('auth.reunlock.wrongPassword'));
      } else if (err instanceof DbClientError && err.code === 'migration_required') {
        // Extremely unlikely: the user is already logged in, so the v2
        // database is open.  Surface a generic "wrong password" rather
        // than pivoting to the migration wizard here — a dedicated
        // `bak-only` cleanup path handles recovery (see B8-8).
        console.error('[reunlock] unexpected migration_required during re-unlock');
        setError(t('auth.reunlock.wrongPassword'));
      } else {
        console.error('[reunlock] failed', err);
        setError(t('auth.reunlock.wrongPassword'));
      }
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('auth.reunlock.title')}</DialogTitle>
          <DialogDescription>{t('auth.reunlock.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="reunlock-password">{t('auth.reunlock.passwordLabel')}</Label>
            <Input
              id="reunlock-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
              {t('auth.reunlock.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !password}>
              {submitting ? t('auth.reunlock.submitting') : t('auth.reunlock.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
