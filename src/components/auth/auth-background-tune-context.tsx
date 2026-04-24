'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AUTH_BACKGROUND_TUNE,
  type AuthBackgroundTune,
} from '@/components/auth/auth-background-tune-defaults';
import { sanitizeAuthBackgroundTune } from '@/components/auth/auth-background-tune-sanitize';
import { isAuthBackgroundTunePanelEnabled } from '@/components/auth/auth-background-tune-visibility';

/** 仅调参面板开启时读写；版本 bump 可清历史沙盒 */
const STORAGE_KEY = 'soul-auth-bg-tune-v3';

type Ctx = {
  tune: AuthBackgroundTune;
  setTune: (
    u:
      | Partial<AuthBackgroundTune>
      | ((prev: AuthBackgroundTune) => AuthBackgroundTune),
  ) => void;
  resetToCodeDefaults: () => void;
};

const AuthBackgroundTuneContext = createContext<Ctx | null>(null);

export function AuthBackgroundTuneProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tune, setTuneState] = useState<AuthBackgroundTune>(AUTH_BACKGROUND_TUNE);

  useEffect(() => {
    if (!isAuthBackgroundTunePanelEnabled()) {
      return;
    }
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        setTuneState(sanitizeAuthBackgroundTune(parsed));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setTune = useCallback(
    (
      u:
        | Partial<AuthBackgroundTune>
        | ((prev: AuthBackgroundTune) => AuthBackgroundTune),
    ) => {
      setTuneState((prev) => {
        const next = sanitizeAuthBackgroundTune(
          typeof u === 'function' ? u(prev) : { ...prev, ...u },
        );
        if (isAuthBackgroundTunePanelEnabled()) {
          try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      });
    },
    [],
  );

  const resetToCodeDefaults = useCallback(() => {
    setTuneState({ ...AUTH_BACKGROUND_TUNE });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem('soul-auth-bg-tune-sandbox');
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ tune, setTune, resetToCodeDefaults }),
    [tune, setTune, resetToCodeDefaults],
  );

  return (
    <AuthBackgroundTuneContext.Provider value={value}>
      {children}
    </AuthBackgroundTuneContext.Provider>
  );
}

export function useAuthBackgroundTune(): Ctx {
  const ctx = useContext(AuthBackgroundTuneContext);
  if (!ctx) {
    throw new Error(
      'useAuthBackgroundTune must be used within AuthBackgroundTuneProvider',
    );
  }
  return ctx;
}
