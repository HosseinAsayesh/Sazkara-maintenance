import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ClientFormsTable } from '@/components/client/ClientFormsTable';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { getClientScope, getClientToday } from '@/lib/client-view';

/**
 * Today's fieldwork, on the Tehran-local day the rest of the app uses. A client
 * refreshing at 1 a.m. must see the same "today" the manager does.
 */
export default async function ClientTodayPage({
  params,
}: PageProps<'/[locale]/client/today'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const rows = await getClientToday(scope.projectId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('todayTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          {t('todayCount', { n: rows.length.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US') })}
        </p>
      </div>
      <ClientFormsTable rows={rows} locale={locale} emptyMessage={t('todayEmpty')} />
    </div>
  );
}
