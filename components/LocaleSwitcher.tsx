'use client';

import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useTransition } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LABELS: Record<string, string> = { fa: 'فارسی', en: 'English' };

/**
 * Switches locale while staying on the current page. `usePathname` from next-intl
 * returns the locale-stripped path, so the router can re-apply the new prefix without
 * hand-parsing the URL — and dynamic segments survive via `params`.
 */
export function LocaleSwitcher({ onDark = false }: { onDark?: boolean } = {}) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={locale}
      disabled={pending}
      aria-label="language"
      onChange={(e) => {
        const next = e.target.value;
        startTransition(() => {
          router.replace(
            // @ts-expect-error -- pathname + params are correct at runtime; the typed
            // route helper cannot narrow a dynamic pathname held in a variable.
            { pathname, params },
            { locale: next },
          );
        });
      }}
      className={
        onDark
          ? // On the graphite bar. The options themselves are drawn by the OS, so they
            // need an explicit dark colour or they inherit white-on-white.
            'rounded-lg border border-white/20 bg-transparent px-2 py-1 text-xs text-white focus:outline-none [&>option]:text-brand-900'
          : 'rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-xs text-brand-600 focus:outline-none'
      }
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {LABELS[l] ?? l}
        </option>
      ))}
    </select>
  );
}
