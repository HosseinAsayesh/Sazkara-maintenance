import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ExportPanel } from '@/components/ExportPanel';
import { requireManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function ExportsPage({ params }: PageProps<'/[locale]/manager/exports'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'exports' });
  const cities = await prisma.city.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>
      <ExportPanel cities={cities} />
    </div>
  );
}
