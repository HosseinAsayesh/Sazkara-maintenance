import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

import { LocaleSwitcher } from './LocaleSwitcher';
import { LogoutButton } from './LogoutButton';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

/**
 * Shared chrome. The nav collapses to a horizontal scroller under `lg`, which is what
 * makes the manager dashboard usable on a tablet and the technician pages usable on a
 * phone without a second layout.
 */
export async function AppShell({
  locale,
  userName,
  userSubtitle,
  nav,
  title,
  actions,
  children,
}: {
  locale: string;
  userName: string;
  userSubtitle?: string;
  nav?: NavItem[];
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'app' });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          {/* The mark carries the brand; the wordmark stays for the tagline and for
              anyone whose images fail to load. `priority` because it is above the fold
              on every page in the app. */}
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Image
              src="/brand/logo.svg"
              alt=""
              width={96}
              height={54}
              priority
              className="h-7 w-auto shrink-0"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-brand-900">
                {t('shortName')}
              </span>
              <span className="block truncate text-[11px] text-[var(--muted)]">
                {t('tagline')}
              </span>
            </span>
          </Link>

          <div className="ms-auto flex items-center gap-2">
            <div className="hidden text-end sm:block">
              <div className="text-xs font-medium text-brand-700">{userName}</div>
              {userSubtitle ? (
                <div className="text-[11px] text-[var(--muted)]">{userSubtitle}</div>
              ) : null}
            </div>
            <LocaleSwitcher />
            <LogoutButton locale={locale} />
          </div>
        </div>

        {nav?.length ? (
          <nav className="mx-auto max-w-7xl overflow-x-auto px-2 pb-1">
            <ul className="flex gap-1 whitespace-nowrap">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-brand-50 hover:text-brand-800"
                  >
                    {item.label}
                    {item.badge ? (
                      <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        {title || actions ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {title ? <h1 className="text-lg font-bold text-brand-900">{title}</h1> : <div />}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
