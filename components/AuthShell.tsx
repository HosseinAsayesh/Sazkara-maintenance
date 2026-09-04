import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from './LocaleSwitcher';

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
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-brand-900">{t('name')}</h1>
            <p className="text-xs text-[var(--muted)]">{t('tagline')}</p>
          </div>
          <LocaleSwitcher />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{subtitle}</p>
          ) : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
