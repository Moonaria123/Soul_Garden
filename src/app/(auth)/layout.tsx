'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { AuthBackgroundTuneProvider } from '@/components/auth/auth-background-tune-context';
import { AuthPageBackground } from '@/components/auth/auth-page-background';
import { MigrationWizard } from '@/components/auth/migration-wizard';
import { StartupHealthCheck } from '@/components/auth/startup-health-check';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/home');
    }
  }, [isAuthenticated, router]);

  return (
    <AuthBackgroundTuneProvider>
      <div className="relative">
        <AuthPageBackground />
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4">
          <div className="absolute right-4 top-4 z-20">
            <LanguageSwitcher />
          </div>
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
      <StartupHealthCheck />
      <MigrationWizard />
    </AuthBackgroundTuneProvider>
  );
}
