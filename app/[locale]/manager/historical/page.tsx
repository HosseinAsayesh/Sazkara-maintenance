import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HistoricalImporter } from '@/components/HistoricalImporter';
import { requireManager } from '@/lib/auth';
import { listProjectOptions } from '@/lib/projects';

export default async function HistoricalPage({
  params,
}: PageProps<'/[locale]/manager/historical'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, projects] = await Promise.all([
    getTranslations({ locale, namespace: 'historical' }),
    listProjectOptions(),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>
      <HistoricalImporter locale={locale} projects={projects} />
    </div>
  );
}
