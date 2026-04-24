'use client';

import { useEffect } from 'react';
import { useLocaleStore } from '@/lib/i18n';

/**
 * Syncs <html lang> attribute with the locale store (SU-ITER-015).
 * Rendered in root layout body — invisible, no DOM output.
 */
export function LangSync() {
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
