import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ImportWizard } from '@/components/ImportWizard';
import { requireManager } from '@/lib/auth';

export default async function NewImportPage({
  params,
}: PageProps<'/[locale]/manager/imports/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'imports' });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('newImport')}</h1>
      <ImportWizard locale={locale} />
    </div>
  );
}
