import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  Card,
  CardHeader,
  EmptyState,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { requireManager } from '@/lib/auth';
import { DAY_MS, formatDateForLocale, RE_REPAIR_WINDOW_DAYS } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** §6.3 — the separate re-repair list. */
export default async function ReRepairsPage({
  params,
}: PageProps<'/[locale]/manager/re-repairs'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'reRepairs' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const forms = await prisma.repairForm.findMany({
    where: { isReRepair: true },
    orderBy: { date: 'desc' },
    take: 200,
    include: {
      stand: { select: { uid: true } },
      city: { select: { name: true } },
      technician: { select: { name: true, technicianCode: true } },
      parts: { include: { part: { select: { nameFa: true, nameEn: true } } } },
    },
  });

  // The form each re-repair followed, so the gap between visits is visible.
  const previousIds = forms.map((f) => f.previousFormId).filter(Boolean) as string[];
  const previous = await prisma.repairForm.findMany({
    where: { id: { in: previousIds } },
    select: { id: true, date: true, formCode: true },
  });
  const previousById = new Map(previous.map((p) => [p.id, p]));

  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={t('help', { days: RE_REPAIR_WINDOW_DAYS })}
      />
      <div className="p-1">
        {forms.length === 0 ? (
          <div className="p-3">
            <EmptyState>{t('empty')}</EmptyState>
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{tc('uid')}</Th>
                  <Th>{tc('store')}</Th>
                  <Th>{tc('city')}</Th>
                  <Th>{tc('technician')}</Th>
                  <Th>{tc('date')}</Th>
                  <Th>{t('gapHeader')}</Th>
                  <Th>{tc('total')}</Th>
                </tr>
              </thead>
              <tbody>
                {forms.map((form) => {
                  const prev = form.previousFormId
                    ? previousById.get(form.previousFormId)
                    : undefined;
                  const gapDays = prev
                    ? Math.max(
                        0,
                        Math.round((form.date.getTime() - prev.date.getTime()) / DAY_MS),
                      )
                    : null;
                  const partsCount = form.parts.reduce((s, p) => s + p.quantity, 0);

                  return (
                    <tr key={form.id}>
                      <Td className="dir-ltr font-medium">
                        <Link
                          href={{ pathname: '/manager/uid', query: { q: form.stand.uid } }}
                          className="text-brand-700 hover:underline"
                        >
                          {form.stand.uid}
                        </Link>
                      </Td>
                      <Td className="max-w-[14rem] truncate">{form.storeName ?? '—'}</Td>
                      <Td>{form.city?.name ?? '—'}</Td>
                      <Td>{form.technician.name}</Td>
                      <Td className="whitespace-nowrap">
                        {formatDateForLocale(form.date, locale)}
                      </Td>
                      <Td className="tabular-nums">
                        {gapDays === null ? '—' : t('daysAfter', { days: gapDays })}
                      </Td>
                      <Td className="tabular-nums">{partsCount}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </Card>
  );
}
