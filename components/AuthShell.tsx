import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
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
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
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
          <LocaleSwitcher />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-brand-900">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{subtitle}</p>
          ) : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
