'use client';

// SU-ITER-090a · R13 — account security card.
//
// Stage B delivered the `/accounts/change-password` v2 route
// (inline dump-and-restore rekey, atomic + server-side session
// eviction).  The UI entry point, however, was still missing —
// users had to hit the API directly to rotate their master
// password.  This card plugs that gap by exposing a dialog that:
//
//   1. Gates the new password through `validatePasswordStrength`
//      (same rules as registration, P1-3).
//   2. Requires current + new + confirm, with an extra
//      "new differs from current" assertion so people don't
//      burn an Argon2id verify on a no-op rekey.
//   3. Calls `dbClient.changePassword` and on success shows a
//      toast with the server-reported rekey stats (total rows /
//      ms) before forcing a sign-out, because the server has
//      already evicted every live session.

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/lib/store/auth-store';
import { changePassword } from '@/lib/db/db-client';
import {
  validatePasswordStrength,
  type PasswordStrengthReason,
} from '@/lib/auth/password-strength';

const STRENGTH_KEYS: Record<PasswordStrengthReason, string> = {
  too_short: 'register.passwordWeak.too_short',
  not_enough_categories: 'register.passwordWeak.not_enough_categories',
  too_common: 'register.passwordWeak.too_common',
  equals_username: 'register.passwordWeak.equals_username',
};

export function AccountSecurityCard() {
  const t = useT();
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strengthErrors = useMemo(() => {
    if (!next) return null;
    const res = validatePasswordStrength(next, {
      username: currentUser?.username,
    });
    if (res.ok) return null;
    return res.reasons.map((r) => t(STRENGTH_KEYS[r]));
  }, [next, currentUser?.username, t]);

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setSubmitting(false);
  }

  const canSubmit =
    current.length > 0 &&
    next.length > 0 &&
    confirm.length > 0 &&
    !strengthErrors &&
    next === confirm &&
    next !== current &&
    !submitting;

  async function handleSubmit() {
    if (!currentUser) return;
    setError(null);

    if (next !== confirm) {
      setError(t('settings.security.mismatch'));
      return;
    }
    if (next === current) {
      setError(t('settings.security.sameAsOld'));
      return;
    }
    const strength = validatePasswordStrength(next, {
      username: currentUser.username,
    });
    if (!strength.ok) {
      setError(strength.reasons.map((r) => t(STRENGTH_KEYS[r])).join(' '));
      return;
    }

    setSubmitting(true);
    try {
      const result = await changePassword({
        id: currentUser.id,
        currentPassword: current,
        newPassword: next,
      });
      // Show stats so the user knows what happened.  Server has already
      // evicted every session; log out locally and close the dialog.
      toast.success(
        t('settings.security.done', {
          rows: result.stats.totalRows,
          ms: result.stats.durationMs,
        }),
      );
      setOpen(false);
      reset();
      // Fire-and-forget: logout clears the client DEK + zustand state
      // and routes the user back to the sign-in screen on next render.
      logout();
    } catch (e: unknown) {
      // The v2 route replies 401 `invalid_credentials` for a wrong
      // `currentPassword`; everything else collapses into a generic
      // error so we don't leak rekey internals.
      const msg = e instanceof Error ? e.message : '';
      if (/invalid_credentials|401/i.test(msg)) {
        setError(t('settings.security.invalidCurrent'));
      } else {
        setError(t('settings.security.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> {t('settings.security.title')}
        </CardTitle>
        <CardDescription>{t('settings.security.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t('settings.security.changePassword.hint')}
        </p>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) reset();
          }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={!currentUser}
          >
            <KeyRound className="h-4 w-4 mr-1" />
            {t('settings.security.changePassword')}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings.security.changePassword')}</DialogTitle>
              <DialogDescription>
                {t('settings.security.changePassword.hint')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="cp-current">{t('settings.security.current')}</Label>
                <Input
                  id="cp-current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-new">{t('settings.security.new')}</Label>
                <Input
                  id="cp-new"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  disabled={submitting}
                />
                {strengthErrors && strengthErrors.length > 0 && (
                  <ul className="text-xs text-destructive space-y-0.5 pl-4 list-disc">
                    {strengthErrors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-confirm">{t('settings.security.confirm')}</Label>
                <Input
                  id="cp-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={submitting}
                />
                {confirm.length > 0 && next !== confirm && (
                  <p className="text-xs text-destructive">
                    {t('settings.security.mismatch')}
                  </p>
                )}
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                {t('settings.security.cancel')}
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {submitting
                  ? t('settings.security.submitting')
                  : t('settings.security.submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
