import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zhCN } from './locales/zh-CN';
import { en } from './locales/en';

export type Locale = 'zh-CN' | 'en';

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en': en,
};

function formatMessage(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  let text = messages[locale][key] ?? messages['zh-CN'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // RLX-ESL-03 (SU-092-batch1): `k` is a developer-controlled translation
      // placeholder key (e.g. `count`, `name`), never user input.  The RegExp
      // constructor call itself is bounded by the size of the `messages` dict
      // keys; `v` is stringified for the replacement value.
      // eslint-disable-next-line security/detect-non-literal-regexp
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'zh-CN',
      setLocale: (locale: Locale) => set({ locale }),
    }),
    { name: 'soul-upload-locale' }
  )
);

/**
 * Returns a translation function `t(key, params?)` that resolves
 * the current locale's message for the given key.
 * Supports `{param}` interpolation: t('chat.placeholder', { name: '外婆' })
 */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);

  return function t(key: string, params?: Record<string, string | number>): string {
    return formatMessage(locale, key, params);
  };
}

export function translate(key: string, params?: Record<string, string | number>): string {
  return formatMessage(useLocaleStore.getState().locale, key, params);
}

export { messages, formatMessage };
