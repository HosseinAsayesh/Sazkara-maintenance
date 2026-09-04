import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CitySettings, WageSettingsForm } from '@/components/SettingsForms';
import { requireManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAppSettings, getWageSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: PageProps<'/[locale]/manager/settings'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'settings' });

  const [wages, app, cities] = await Promise.all([
    getWageSettings(),
    getAppSettings(),
    prisma.city.findMany({
      orderBy: [{ isTehran: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isTehran: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <WageSettingsForm
        locale={locale}
        wages={wages}
        app={{ companyName: app.companyName, managerContactEmail: app.managerContactEmail }}
      />

      <CitySettings locale={locale} cities={cities} />
    </div>
  );
}
