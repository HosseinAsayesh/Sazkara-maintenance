import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ClientPartsTable } from '@/components/client/ClientPartsTable';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { getClientPartsUsage, getClientScope } from '@/lib/client-view';

export default async function ClientPartsPage({
  params,
}: PageProps<'/[locale]/client/parts'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const report = await getClientPartsUsage(scope.projectId);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('partsPageTitle')}</h1>
      <ClientPartsTable report={report} locale={locale} />
    </div>
  );
}
