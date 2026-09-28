import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ClientReportCard } from '@/components/client/ClientReportCard';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { getClientReportCard, getClientScope } from '@/lib/client-view';

export default async function ClientReportCardPage({
  params,
}: PageProps<'/[locale]/client'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();

  // No active campaign means there is nothing to report on. Saying so plainly beats a
  // page of zeroes, which reads as "the work stopped".
  if (!scope) {
    return <Alert tone="info">{t('noActiveProject')}</Alert>;
  }

  const data = await getClientReportCard(scope.projectId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('reportCardTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          {t('projectLabel', { name: scope.projectName })}
        </p>
      </div>
      <ClientReportCard data={data} locale={locale} />
    </div>
  );
}
