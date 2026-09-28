import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ClientFormsTable } from '@/components/client/ClientFormsTable';
import { Alert, Button } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { requireClientViewer } from '@/lib/auth';
import { getClientForms, getClientScope } from '@/lib/client-view';

/**
 * Every report in the campaign, paged.
 *
 * Paged through the URL rather than a client-side list, so a page of results is a link
 * the client can paste into an email to us and we both land on the same rows.
 */
export default async function ClientReportsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/client/reports'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const sp = await searchParams;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);

  const result = await getClientForms(scope.projectId, { page });
  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('reportsTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          {t('reportsCount', { n: num(result.total) })}
        </p>
      </div>

      <ClientFormsTable rows={result.rows} locale={locale} emptyMessage={t('reportsEmpty')} />

      {lastPage > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--muted)]">
            {t('pageOf', { page: num(result.page), total: num(lastPage) })}
          </span>
          <span className="flex gap-2">
            {result.page > 1 ? (
              <Link href={{ pathname: '/client/reports', query: { page: result.page - 1 } }}>
                <Button variant="secondary">{t('previousPage')}</Button>
              </Link>
            ) : null}
            {result.page < lastPage ? (
              <Link href={{ pathname: '/client/reports', query: { page: result.page + 1 } }}>
                <Button variant="secondary">{t('nextPage')}</Button>
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
