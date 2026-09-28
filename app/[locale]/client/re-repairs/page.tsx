import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ClientFormsTable } from '@/components/client/ClientFormsTable';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { getClientReRepairs, getClientScope } from '@/lib/client-view';

/**
 * §6.3 — stands repaired twice inside this campaign.
 *
 * Shown to the client deliberately, even though it is the least flattering list here:
 * a stand that failed again is the one they will hear about from their retailer, and
 * finding it in our panel is better than finding it from the shop.
 */
export default async function ClientReRepairsPage({
  params,
}: PageProps<'/[locale]/client/re-repairs'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const rows = await getClientReRepairs(scope.projectId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('reRepairsTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('reRepairsHelp')}</p>
      </div>
      <ClientFormsTable rows={rows} locale={locale} emptyMessage={t('reRepairsEmpty')} />
    </div>
  );
}
