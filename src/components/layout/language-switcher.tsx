'use client';

import { useEffect } from 'react';
import { useLocaleStore, type Locale } from '@/lib/i18n';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocaleStore();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('soul-upload-locale')) return;

    const detectedLocale: Locale = navigator.language.toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';

    if (detectedLocale !== locale) {
      setLocale(detectedLocale);
    }
  }, [locale, setLocale]);

  const toggle = () => {
    setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN');
  };

  return (
    <button
      onClick={toggle}
      className="px-2 py-1 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted text-foreground transition-colors"
      aria-label="Switch language"
    >
      {locale === 'zh-CN' ? 'EN' : '中文'}
    </button>
  );
}
