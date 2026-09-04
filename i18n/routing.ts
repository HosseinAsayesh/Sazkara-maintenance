import { defineRouting } from 'next-intl/routing';

export const locales = ['fa', 'en'] as const;
export type Locale = (typeof locales)[number];

/** Persian is the default and the working language of the field team. */
export const defaultLocale: Locale = 'fa';

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Always keep the locale in the path so a shared link is unambiguous.
  localePrefix: 'always',
});

export function directionOf(locale: string): 'rtl' | 'ltr' {
  return locale === 'fa' ? 'rtl' : 'ltr';
}
