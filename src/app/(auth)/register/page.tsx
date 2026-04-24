"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shield } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
  type PasswordStrengthReason,
} from "@/lib/auth/password-strength";
import { AuthBackgroundTunePanel } from "@/components/auth/auth-background-tune-panel";
import {
  authGlassCardClass,
  authGlassInputClass,
} from "@/components/auth/auth-styles";

export default function RegisterPage() {
  const router = useRouter();
  const t = useT();
  const { register, isLoading, error, clearError } = useAuthStore();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (username.trim().length < 2) {
      setLocalError(t("register.usernameMin"));
      return;
    }
    // SU-ITER-089 · P1-3 — centralised strength check (length + 3-of-4
    // categories + denylist + username similarity).  Join multiple
    // reasons so the user sees every fix at once.
    const strength = validatePasswordStrength(password, {
      username: username.trim(),
    });
    if (!strength.ok) {
      const reasonKeys: Record<PasswordStrengthReason, string> = {
        too_short: "register.passwordWeak.too_short",
        not_enough_categories: "register.passwordWeak.not_enough_categories",
        too_common: "register.passwordWeak.too_common",
        equals_username: "register.passwordWeak.equals_username",
      };
      setLocalError(strength.reasons.map((r) => t(reasonKeys[r])).join(" "));
      return;
    }
    // RLX-ESL-04 (SU-092-batch1): client-side UX check comparing two local
    // form fields — no timing-oracle exposure to an attacker.  The actual
    // credential comparison is server-side with a timing-safe path under
    // `/api/auth/login` (see SU-090a R10 rate-limit + Argon2id verify).
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmPassword) {
      setLocalError(t("register.passwordMismatch"));
      return;
    }

    await register(username.trim(), password, email.trim() || undefined);

    if (useAuthStore.getState().isAuthenticated) {
      router.push("/home");
    }
  };

  const displayError = localError || error;

  return (
    <>
      <AuthBackgroundTunePanel />
      <Card className={authGlassCardClass}>
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl font-bold text-foreground font-[family-name:var(--font-display)]">
            {t("register.title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("register.tagline")}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-secondary/30 bg-secondary/35 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm">
              <Shield className="h-4 w-4 shrink-0 text-primary" />
              <span>{t("register.localOnlyNotice")}</span>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {t("register.singleUserHint")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">{t("register.username")}</Label>
              <Input
                id="username"
                type="text"
                placeholder={t("register.usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                disabled={isLoading}
                className={authGlassInputClass}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">
                {t("register.email")}{" "}
                <span className="text-muted-foreground text-xs">
                  {t("register.emailOptional")}
                </span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder={t("register.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={isLoading}
                className={authGlassInputClass}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("register.password")}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t("register.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                disabled={isLoading}
                className={authGlassInputClass}
              />
              <p className="text-xs text-muted-foreground">
                {t("register.passwordRequirements")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t("register.confirmPassword")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t("register.confirmPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={isLoading}
                className={authGlassInputClass}
              />
            </div>

            {displayError && (
              <p className="text-sm text-destructive text-center">
                {displayError}
              </p>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t("register.loading") : t("register.submit")}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              {t("register.hasAccount")}{" "}
              <Link href="/login" className="text-primary hover:underline">
                {t("register.login")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}
