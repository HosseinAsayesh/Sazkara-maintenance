import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from './LocaleSwitcher';

/**
 * Line-work echoing the logo's construction: the same angled uprights and connecting
 * diagonals, drawn large and faint so the panel reads as built rather than decorated.
 * Purely presentational, so it is hidden from assistive technology.
 */
function BrandLinework() {
  return (
    <svg
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
    >
      <g stroke="#8ebebe" strokeWidth="1.5" fill="none">
        <path d="M40 460 L40 190 L150 120 L150 390 Z" />
        <path d="M150 390 L150 120 L260 190 L260 460 Z" />
        <path d="M260 460 L260 190 L370 120 L370 390 Z" />
        <path d="M40 190 L150 120 L260 190 L370 120" />
        <path d="M40 460 L150 390 L260 460 L370 390" />
      </g>
    </svg>
  );
}

/**
 * The signed-out chrome: a graphite brand panel beside the form.
 *
 * The panel is the brand statement, so it carries the white mark at a size where the
 * geometry actually reads. It is `lg` and up only — on a phone it would push the form
 * below the fold, and a technician signing in from a shop floor should land on the
 * fields. There the mark moves inline above the form instead, so branding survives the
 * breakpoint without costing a scroll.
 */
export async function AuthShell({
  title,
  subtitle,
  locale,
  children,
}: {
  title: string;
  subtitle?: string;
  locale: string;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'app' });

  return (
    <main className="flex min-h-dvh">
      <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-brand-900 px-11 py-12 text-white lg:flex">
        <BrandLinework />

        <div className="relative">
          <Image
            src="/brand/logo-white.svg"
            alt={t('name')}
            width={160}
            height={90}
            priority
            className="h-[76px] w-auto"
          />
        </div>

        <div className="relative">
          <h2 className="text-[28px] font-bold leading-[1.5] tracking-[-0.01em]">
            {t('brandHeadline')}
          </h2>
          <div className="my-5 h-[3px] w-[46px] bg-teal-400" />
          <p className="max-w-[42ch] text-sm leading-[1.9] text-brand-200">{t('brandBlurb')}</p>
        </div>

        <div className="relative text-[11px] text-ink-400 dir-ltr">sazkara.com</div>
      </aside>

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-12">
        <div className="w-full max-w-[372px]">
          {/* Stands in for the brand panel below `lg`. */}
          <div className="mb-8 lg:hidden">
            <Image
              src="/brand/logo.svg"
              alt={t('name')}
              width={160}
              height={90}
              priority
              className="h-11 w-auto"
            />
            <p className="mt-2.5 text-xs text-[var(--muted)]">{t('tagline')}</p>
          </div>

          <h1 className="text-[22px] font-bold text-brand-900">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-[13px] leading-5 text-[var(--muted)]">{subtitle}</p>
          ) : null}

          <div className="mt-7">{children}</div>

          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <LocaleSwitcher />
          </div>
        </div>
      </div>
    </main>
  );
}
