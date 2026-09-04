import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RepairFormClient } from '@/components/RepairFormClient';
import { StandHistory } from '@/components/StandHistory';
import { Alert } from '@/components/ui';
import { requireTechnician } from '@/lib/auth';
import { formatDateForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { lookupUid } from '@/lib/repair-forms';

export default async function StandFormPage({
  params,
}: PageProps<'/[locale]/technician/stand/[uid]'>) {
  const { locale, uid: rawUid } = await params;
  setRequestLocale(locale);

  const user = await requireTechnician(locale);
  const [t, tt] = await Promise.all([
    getTranslations({ locale, namespace: 'form' }),
    getTranslations({ locale, namespace: 'technician' }),
  ]);

  const lookup = await lookupUid(decodeURIComponent(rawUid));

  const [parts, cities] = await Promise.all([
    prisma.partCatalogItem.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        nameFa: true,
        nameEn: true,
        sortOrder: true,
        unit: true,
        quantityStep: true,
      },
    }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">
        {t('title')} · <span className="dir-ltr">{lookup.uid}</span>
      </h1>

      {/* §4.3 — a uid outside the current order can still be reported, but the manager
          has to admit it to the official record afterwards. */}
      {lookup.isUnmatched ? (
        <Alert tone="warning" title={tt('notFoundInOrder')}>
          {tt('notFoundHelp')}
        </Alert>
      ) : null}

      {lookup.isPendingConfirmation ? (
        <Alert tone="info">{tt('pendingConfirmBadge')}</Alert>
      ) : null}

      {/* §6.3 — warn before the form is filled in, not after it is submitted. The
          trigger is the project boundary, so the two cases read differently: a repeat
          inside this campaign is a re-repair, while history from an earlier campaign is
          context the technician should see but is not a re-repair. */}
      {lookup.wouldBeReRepair && lookup.previousInProject ? (
        <Alert tone="warning" title={tt('reRepairWarning')}>
          {tt('lastRepairedOn', {
            date: formatDateForLocale(lookup.previousInProject.date, locale),
          })}
        </Alert>
      ) : lookup.hasPreviousProjectHistory && lookup.lastRepaired ? (
        <Alert tone="info" title={tt('previousProjectNotice')}>
          {tt('lastRepairedOn', {
            date: formatDateForLocale(lookup.lastRepaired.date, locale),
          })}
        </Alert>
      ) : null}

      {/* §4.3 — compact history before the form so the technician knows what was done. */}
      <StandHistory locale={locale} history={lookup.history} />

      <RepairFormClient
        locale={locale}
        uid={lookup.uid}
        technicianName={user.name}
        technicianCode={user.technicianCode}
        technicianPhone={user.phone}
        todayLabel={formatDateForLocale(new Date(), locale)}
        parts={parts}
        cities={cities}
        prefill={{
          storeName: lookup.prefill.storeName,
          storeAddress: lookup.prefill.storeAddress,
          storeManagerName: lookup.prefill.storeManagerName,
          storePhone: lookup.prefill.storePhone,
          digitalAddress: lookup.prefill.digitalAddress,
          cityId: lookup.prefill.cityId,
        }}
        isUnmatched={lookup.isUnmatched}
        wouldBeReRepair={lookup.wouldBeReRepair}
      />
    </div>
  );
}
