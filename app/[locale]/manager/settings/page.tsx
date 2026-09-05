import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CityManager } from '@/components/CityManager';
import { WageSettingsForm } from '@/components/SettingsForms';
import { requireManager } from '@/lib/auth';
import { findDuplicateCityGroups, listCitiesWithUsage } from '@/lib/cities';
import { getAppSettings, getWageSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: PageProps<'/[locale]/manager/settings'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'settings' });

  const [wages, app, cities, duplicateGroups] = await Promise.all([
    getWageSettings(),
    getAppSettings(),
    listCitiesWithUsage(),
    findDuplicateCityGroups(),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <WageSettingsForm
        locale={locale}
        wages={wages}
        app={{ companyName: app.companyName, managerContactEmail: app.managerContactEmail }}
      />

      <CityManager
        locale={locale}
        cities={cities}
        duplicateGroups={duplicateGroups.map((group) => group.map((c) => c.id))}
      />
    </div>
  );
}
