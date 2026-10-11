import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BackupPanel } from '@/components/BackupPanel';
import { ChangeNameCard } from '@/components/ChangeNameCard';
import { ChangePasswordCard } from '@/components/ChangePasswordCard';
import { CityManager } from '@/components/CityManager';
import { JtiAccountSettings } from '@/components/JtiAccountSettings';
import { LicenseSettings } from '@/components/LicenseSettings';
import { LogoSettings } from '@/components/LogoSettings';
import { WageSettingsForm } from '@/components/SettingsForms';
import { requireManager } from '@/lib/auth';
import { findDuplicateCityGroups, listCitiesWithUsage } from '@/lib/cities';
import { findClientAccount } from '@/lib/client-account';
import { formatDateForLocale } from '@/lib/dates';
import { currentLicense } from '@/lib/license';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { getAppSettings, getWageSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: PageProps<'/[locale]/manager/settings'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'settings' });

  const [wages, app, cities, duplicateGroups, license, jti, projects] = await Promise.all([
    getWageSettings(),
    getAppSettings(),
    listCitiesWithUsage(),
    findDuplicateCityGroups(),
    currentLicense(),
    findClientAccount(),
    prisma.project.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <WageSettingsForm
        locale={locale}
        wages={wages}
        app={{ companyName: app.companyName, managerContactEmail: app.managerContactEmail }}
      />

      <LogoSettings
        locale={locale}
        logoUrl={app.logoRef ? getStorage().url(app.logoRef) : null}
      />

      <CityManager
        locale={locale}
        cities={cities}
        duplicateGroups={duplicateGroups.map((group) => group.map((c) => c.id))}
      />

      <BackupPanel projects={projects} />

      <ChangeNameCard name={user.name} />

      <ChangePasswordCard />

      <JtiAccountSettings locale={locale} account={jti} />

      <LicenseSettings
        locale={locale}
        status={license.status}
        licensee={license.licensee}
        expiresLabel={license.expiresAt ? formatDateForLocale(license.expiresAt, locale) : null}
        daysLeft={license.daysLeft}
      />
    </div>
  );
}
