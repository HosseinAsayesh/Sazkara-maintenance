import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CityBarChart, PartRateChart, ReasonBarChart, SuccessPieChart } from '@/components/Charts';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { ForecastPanel } from '@/components/ForecastPanel';
import {
  Card,
  CardHeader,
  EmptyState,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';
import { getOverview, getPartRates } from '@/lib/analytics';
import { requireManager } from '@/lib/auth';
import { localDayRange } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/manager/analytics'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const sp = await searchParams;
  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const to = typeof sp.to === 'string' ? sp.to : undefined;
  const cityId = typeof sp.cityId === 'string' ? sp.cityId : undefined;
  const range = localDayRange(from, to);
  const filters = { from: range.from, to: range.to, cityId };

  const [t, tc, tr, td] = await Promise.all([
    getTranslations({ locale, namespace: 'analytics' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'reasons' }),
    getTranslations({ locale, namespace: 'dashboard' }),
  ]);

  const [overview, partRates, cities] = await Promise.all([
    getOverview(filters),
    getPartRates(filters),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const visited = overview.totals.repaired + overview.totals.notRepaired;
  const nameOf = (row: { nameFa: string; nameEn: string }) =>
    locale === 'fa' ? row.nameFa : row.nameEn;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <DateRangeFilter from={from} to={to} cities={cities} cityId={cityId} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={td('repaired')} value={overview.totals.repaired} tone="success" />
        <StatCard label={td('notRepaired')} value={overview.totals.notRepaired} tone="danger" />
        <StatCard
          label={t('successRateTitle')}
          value={`${overview.totals.successRate}٪`}
          tone="info"
        />
        <StatCard
          label={t('forecastBasis')}
          value={partRates.repairedStandCount}
          hint={t('basisForms', { count: partRates.repairedStandCount })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('successRateTitle')} description={t('successRateHelp')} />
          <div className="p-3">
            {visited === 0 ? (
              <EmptyState>{td('noData')}</EmptyState>
            ) : (
              <SuccessPieChart
                repaired={overview.totals.repaired}
                notRepaired={overview.totals.notRepaired}
                labels={{ repaired: t('chartRepaired'), notRepaired: t('chartNotRepaired') }}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('reasonsTitle')} />
          <div className="p-3">
            {overview.reasons.length === 0 ? (
              <EmptyState>{td('noData')}</EmptyState>
            ) : (
              <ReasonBarChart
                data={overview.reasons.map((r) => ({ label: tr(r.reason), value: r.count }))}
              />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={td('byCity')} />
        <div className="p-3">
          {overview.cities.length === 0 ? (
            <EmptyState>{td('noData')}</EmptyState>
          ) : (
            <CityBarChart
              data={overview.cities.map((c) => ({
                label: c.cityName,
                repaired: c.repaired,
                notRepaired: c.notRepaired,
              }))}
              labels={{ repaired: t('chartRepaired'), notRepaired: t('chartNotRepaired') }}
            />
          )}
        </div>
      </Card>

      {/* §10 — "53% of stands needed a transformer replaced". */}
      <Card>
        <CardHeader title={t('partsRateTitle')} description={t('partsRateHelp')} />
        <div className="p-3">
          {partRates.repairedStandCount === 0 ? (
            <EmptyState>{td('noData')}</EmptyState>
          ) : (
            <>
              <PartRateChart
                data={partRates.rows.map((r) => ({
                  label: nameOf(r),
                  value: r.percentOfStands,
                }))}
              />
              <TableWrap>
                <Table className="mt-4 min-w-0">
                  <thead>
                    <tr>
                      <Th>{tc('part')}</Th>
                      <Th>{t('percentOfStands')}</Th>
                      <Th>{tc('total')}</Th>
                      <Th>{t('forecastRatePerStand')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {partRates.rows
                      .filter((r) => r.totalQuantity > 0)
                      .map((row) => (
                        <tr key={row.sortOrder}>
                          <Td>{nameOf(row)}</Td>
                          <Td className="tabular-nums">{row.percentOfStands}٪</Td>
                          <Td className="tabular-nums">{row.totalQuantity}</Td>
                          <Td className="tabular-nums">{row.perStandRate.toFixed(3)}</Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </TableWrap>
            </>
          )}
        </div>
      </Card>

      <ForecastPanel locale={locale} from={from} to={to} cityId={cityId} />
    </div>
  );
}
