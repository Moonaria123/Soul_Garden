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
import { Heart } from "lucide-react";
import { useT } from "@/lib/i18n";
import { AuthBackgroundTunePanel } from "@/components/auth/auth-background-tune-panel";
import {
  authGlassCardClass,
  authGlassInputClass,
} from "@/components/auth/auth-styles";

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const { login, isLoading, error, clearError } = useAuthStore();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    await login(username.trim(), password);

    if (useAuthStore.getState().isAuthenticated) {
      router.push("/home");
    }
  };

  return (
    <>
      <AuthBackgroundTunePanel />
      <Card className={authGlassCardClass}>
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl font-bold text-foreground font-[family-name:var(--font-display)]">
            {t("login.title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground flex items-center justify-center gap-1.5">
            <Heart className="h-3.5 w-3.5 text-primary" />
            {t("login.tagline")}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t("login.username")}</Label>
              <Input
                id="username"
                type="text"
                placeholder={t("login.usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                disabled={isLoading}
                className={authGlassInputClass}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t("login.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={isLoading}
                className={authGlassInputClass}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t("login.loading") : t("login.submit")}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              {t("login.noAccount")}{" "}
              <Link href="/register" className="text-primary hover:underline">
                {t("login.createAccount")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}
