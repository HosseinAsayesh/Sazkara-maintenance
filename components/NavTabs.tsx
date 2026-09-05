'use client';

import clsx from 'clsx';

import { Link, usePathname } from '@/i18n/navigation';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

/**
 * The tab strip in the dark bar. Client-side only because the active tab depends on the
 * current path; everything else in the shell stays on the server.
 *
 * Matching is longest-prefix rather than exact, so a detail page keeps its section lit:
 * `/manager/orders/12` marks «سفارش‌ها» active. The section root would otherwise be the
 * only page that ever highlights. `/manager` is a prefix of every manager route, hence
 * picking the longest match rather than the first.
 */
export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  let activeHref: string | null = null;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(item.href + '/');
    if (matches && (activeHref === null || item.href.length > activeHref.length)) {
      activeHref = item.href;
    }
  }

  return (
    <nav className="no-scrollbar -mx-1 overflow-x-auto">
      <ul className="flex gap-1 whitespace-nowrap px-1">
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] transition-colors',
                  active
                    ? 'border-teal-400 font-semibold text-white'
                    : 'border-transparent text-ink-300 hover:text-white',
                )}
              >
                {item.label}
                {item.badge ? (
                  <span className="rounded-full bg-amber-700 px-1.5 py-px text-[10px] font-semibold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
