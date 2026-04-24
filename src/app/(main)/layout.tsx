'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import { IdleTimeoutProvider } from '@/components/auth/idle-timeout-provider';
import { ReUnlockDialog } from '@/components/auth/reunlock-dialog';
import { useSessionSettingsStore } from '@/lib/store/session-settings-store';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Button } from '@/components/ui/button';
import { Home, Settings, LogOut, Flame, User } from 'lucide-react';
import { useT } from '@/lib/i18n';
import Link from 'next/link';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const { isAuthenticated, checkExistingSession, logout } = useAuthStore();
  const loadSessionSettings = useSessionSettingsStore((s) => s.loadSettings);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!isAuthenticated) {
        const hasSession = await checkExistingSession();
        if (!hasSession) {
          router.replace('/login');
          return;
        }
      }
      // Session restored or already active — load user's session settings
      // so IdleTimeoutProvider picks up the correct timeout.
      loadSessionSettings().catch((e) =>
        console.warn('[main] loadSessionSettings failed', e)
      );
      setChecked(true);
    };
    check();
  }, [isAuthenticated, checkExistingSession, loadSessionSettings, router]);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  // Hide nav on chat pages (full-screen)
  const isChatPage = pathname?.includes('/chat');

  if (!checked && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">
          {t('session.restoring')}
        </div>
      </div>
    );
  }

  return (
    <IdleTimeoutProvider>
      <div className="min-h-screen bg-background">
        {/* Top navigation bar (hidden on chat pages) */}
        {!isChatPage && (
          <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-sm">
            <div className="container max-w-4xl mx-auto flex items-center justify-between px-4 h-14">
              <Link href="/home" className="flex items-center gap-2 sm:gap-3 group min-w-0">
                <Flame className="h-5 w-5 shrink-0 text-primary group-hover:text-primary/80 transition-colors" />
                <span className="flex min-w-0 flex-col gap-0 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="font-semibold text-foreground font-[family-name:var(--font-display)] shrink-0">
                    {t('nav.brand')}
                  </span>
                  <span className="text-[11px] font-normal leading-tight text-muted-foreground sm:text-xs sm:max-w-[min(14rem,28vw)] sm:truncate font-[family-name:var(--font-body)]">
                    {t('nav.slogan')}
                  </span>
                </span>
              </Link>
              <nav className="flex items-center gap-1">
                <Link href="/home">
                  <Button
                    variant={pathname === '/home' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-1.5"
                  >
                    <Home className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('nav.home')}</span>
                  </Button>
                </Link>
                <Link href="/me">
                  <Button
                    variant={pathname === '/me' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-1.5"
                  >
                    <User className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('nav.me')}</span>
                  </Button>
                </Link>
                <Link href="/settings">
                  <Button
                    variant={pathname === '/settings' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-1.5"
                  >
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('nav.settings')}</span>
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('nav.logout')}</span>
                </Button>
                <LanguageSwitcher />
              </nav>
            </div>
          </header>
        )}

        {children}
      </div>
      <ReUnlockDialog />
    </IdleTimeoutProvider>
  );
}
