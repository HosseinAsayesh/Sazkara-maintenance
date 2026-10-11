import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

import { FontSizeControl } from './FontSizeControl';
import { LicenseBanner } from './LicenseBanner';
import { LocaleSwitcher } from './LocaleSwitcher';
import { LogoutButton } from './LogoutButton';
import { NavTabs, type NavItem } from './NavTabs';
import { PushToggle } from './PushToggle';

export type { NavItem };

/** First character of the display name, for the avatar disc. */
function initial(name: string) {
  return [...name.trim()][0] ?? '';
}

/**
 * Shared chrome: a graphite bar carrying the white mark, the signed-in user, and the
 * section tabs.
 *
 * The bar is dark on purpose — it is the one place the brand speaks on an otherwise
 * quiet working surface, and it separates the app's own chrome from the white cards
 * holding the fieldwork. Every section stays visible: the tabs wrap onto further rows on
 * a wide screen, and a long list opens from a ☰ menu on a phone (see NavTabs).
 */
export async function AppShell({
  locale,
  userName,
  userSubtitle,
  nav,
  title,
  subtitle,
  actions,
  isManager = false,
  notifications = false,
  children,
}: {
  locale: string;
  userName: string;
  userSubtitle?: string;
  nav?: NavItem[];
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Managers also get the "license expires soon" notice and a link to fix it. */
  isManager?: boolean;
  /** Show the bell that turns on push notifications (managers and crew leads). */
  notifications?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'app' });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 bg-brand-900 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-7">
          <div className="flex items-center justify-between gap-3 py-3 sm:gap-6">
            {/* `priority` because the mark is above the fold on every page in the app. */}
            <Link href="/" className="flex shrink-0 items-center gap-3.5">
              <Image
                src="/brand/logo-white.svg"
                alt={t('shortName')}
                width={110}
                height={62}
                priority
                className="h-[30px] w-auto shrink-0"
              />
              <span className="hidden h-[22px] w-px bg-white/20 sm:block" />
              <span className="hidden truncate text-xs text-ink-300 sm:block">{t('name')}</span>
            </Link>

            {/* Tighter on a phone, and without the decorative avatar, so the logo keeps
                its place beside the bell, text size, language and sign-out controls. */}
            <div className="flex shrink-0 items-center gap-2 sm:gap-3.5">
              <div className="hidden text-end sm:block">
                <div className="text-[0.8125rem] font-medium">{userName}</div>
                {userSubtitle ? (
                  <div className="text-[0.6875rem] text-ink-300 dir-ltr">{userSubtitle}</div>
                ) : null}
              </div>
              <span
                aria-hidden="true"
                className="hidden h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-teal-600 text-[0.8125rem] font-semibold text-white sm:flex"
              >
                {initial(userName)}
              </span>
              {notifications ? <PushToggle /> : null}
              <FontSizeControl />
              <LocaleSwitcher onDark />
              <LogoutButton locale={locale} onDark />
            </div>
          </div>

          {nav?.length ? <NavTabs items={nav} /> : null}
        </div>
      </header>

      <LicenseBanner locale={locale} isManager={isManager} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-7">
        {title || actions ? (
          <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
            {title ? (
              <div>
                <h1 className="text-lg font-bold text-brand-900">{title}</h1>
                {subtitle ? (
                  <div className="mt-1 text-xs text-[var(--muted)]">{subtitle}</div>
                ) : null}
              </div>
            ) : (
              <div />
            )}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
