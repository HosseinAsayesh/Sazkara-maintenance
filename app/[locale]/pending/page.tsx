import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/AuthShell';
import { Alert } from '@/components/ui';
import { Link } from '@/i18n/navigation';

export default async function PendingPage({ params }: PageProps<'/[locale]/pending'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <AuthShell title={t('pendingTitle')} locale={locale}>
      <div className="space-y-4">
        <Alert tone="warning">{t('pendingBody')}</Alert>
        <Link
          href="/login"
          className="block rounded-lg border border-[var(--border)] px-4 py-2 text-center text-sm font-medium text-brand-700 hover:bg-brand-50"
        >
          {t('login')}
        </Link>
      </div>
    </AuthShell>
  );
}
