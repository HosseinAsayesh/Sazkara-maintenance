'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
  /** Other routes that belong to this tab, e.g. a detail page living at its own path. */
  alsoMatches?: string[];
}

/** Up to this many sections fit one row on a phone, so they need no menu. */
const FITS_ON_A_PHONE = 4;

/**
 * The section menu in the dark bar. Client-side only because the active tab depends on
 * the current path; everything else in the shell stays on the server.
 *
 * Every section is always visible. The manager has seventeen, and they used to sit on
 * one sideways-scrolling row with its scrollbar hidden — reachable on a desktop only by
 * holding Shift over the wheel, which nobody remembers. Now they wrap onto as many rows
 * as they need on a wide screen, and on a phone they open from a ☰ menu button (a short
 * list, like the technician's, still shows as plain tabs).
 *
 * Matching is longest-prefix rather than exact, so a detail page keeps its section lit:
 * `/manager/orders/12` marks «سفارش‌ها» active. The section root would otherwise be the
 * only page that ever highlights. `/manager` is a prefix of every manager route, hence
 * picking the longest match rather than the first.
 */
export function NavTabs({ items }: { items: NavItem[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  let activeHref: string | null = null;
  for (const item of items) {
    const prefix = [item.href, ...(item.alsoMatches ?? [])].find(
      (href) => pathname === href || pathname.startsWith(href + '/'),
    );
    if (prefix && (activeHref === null || prefix.length > activeHref.length)) {
      activeHref = item.href;
    }
  }

  const active = items.find((item) => item.href === activeHref);
  const badgeTotal = items.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  const needsMenu = items.length > FITS_ON_A_PHONE;

  const badge = (n?: number) =>
    n ? (
      <span className="rounded-full bg-amber-700 px-1.5 py-px text-[0.625rem] font-semibold text-white">
        {n}
      </span>
    ) : null;

  return (
    <nav>
      {/* Phone: the current section and a button that lists them all. */}
      {needsMenu ? (
        <div className="flex items-center justify-between gap-3 pb-2 sm:hidden">
          <span className="truncate border-b-2 border-teal-400 px-1 py-1.5 text-[0.8125rem] font-semibold">
            {active?.label ?? ''}
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/25 px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-white/10"
          >
            <span aria-hidden className="text-base leading-none">
              {open ? '✕' : '☰'}
            </span>
            {t('menu')}
            {!open ? badge(badgeTotal) : null}
          </button>
        </div>
      ) : null}

      <ul
        className={clsx(
          'gap-1 px-1',
          // Wide screens: wrap onto further rows rather than hide anything off-screen.
          'sm:-mx-1 sm:flex sm:flex-wrap',
          needsMenu
            ? open
              ? 'grid grid-cols-2 pb-3'
              : 'hidden'
            : 'no-scrollbar -mx-1 flex overflow-x-auto whitespace-nowrap',
        )}
      >
        {items.map((item) => {
          const isActive = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                // Following a link closes the phone menu.
                onClick={() => setOpen(false)}
                className={clsx(
                  'inline-flex w-full items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[0.8125rem] transition-colors',
                  // In the phone menu a long name wraps rather than being cut off.
                  needsMenu ? 'sm:whitespace-nowrap' : 'whitespace-nowrap',
                  isActive
                    ? 'border-teal-400 font-semibold text-white'
                    : 'border-transparent text-ink-300 hover:text-white',
                  needsMenu && open && 'rounded-md bg-white/5 sm:rounded-none sm:bg-transparent',
                )}
              >
                {item.label}
                {badge(item.badge)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
