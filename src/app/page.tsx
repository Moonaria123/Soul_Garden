'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import { useT } from '@/lib/i18n';

/**
 * 根路由：根据认证状态重定向
 * - 已登录 → /home（意识图书馆主页）
 * - 未登录 → /login
 */
export default function RootPage() {
  const router = useRouter();
  const t = useT();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const checkExistingSession = useAuthStore((s) => s.checkExistingSession);

  useEffect(() => {
    const init = async () => {
      if (isAuthenticated) {
        router.replace('/home');
        return;
      }
      const hasSession = await checkExistingSession();
      if (hasSession) {
        router.replace('/home');
      } else {
        router.replace('/login');
      }
    };
    init();
  }, [isAuthenticated, checkExistingSession, router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-muted-foreground text-sm animate-pulse">
        {t('session.restoring')}
      </div>
    </div>
  );
}
