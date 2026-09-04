import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AddCityInline } from '@/components/AddCityInline';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { LiveRefresher } from '@/components/LiveRefresher';
import { ReasonBarChart } from '@/components/Charts';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { getOverview } from '@/lib/analytics';
import { requireManager } from '@/lib/auth';
import { formatDateTimeForLocale, localDayRange } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listProjectOptions } from '@/lib/projects';

// The dashboard must reflect submissions as they land (§7), so nothing here is cached.
export const dynamic = 'force-dynamic';

export default async function ManagerDashboard({
  params,
  searchParams,
}: PageProps<'/[locale]/manager'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const sp = await searchParams;
  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const to = typeof sp.to === 'string' ? sp.to : undefined;
  const cityId = typeof sp.cityId === 'string' ? sp.cityId : undefined;
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : undefined;
  const phaseId = typeof sp.phaseId === 'string' ? sp.phaseId : undefined;
  const range = localDayRange(from, to);

  const [t, tc, tr, to_] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'reasons' }),
    getTranslations({ locale, namespace: 'outcome' }),
  ]);

  const [overview, cities, projects, recent] = await Promise.all([
    getOverview({ from: range.from, to: range.to, cityId, projectId, phaseId }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listProjectOptions(),
    prisma.repairForm.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        stand: { select: { uid: true } },
        city: { select: { name: true } },
        technician: { select: { name: true } },
      },
    }),
  ]);

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>
        <LiveRefresher />
      </div>

      <DateRangeFilter
        from={from}
        to={to}
        cities={cities}
        cityId={cityId}
        projects={projects}
        projectId={projectId}
        phaseId={phaseId}
      />

      {/* Deliberately outside the filter card: AddCityInline is itself a <form>, and a
          form nested inside the filter's form is invalid HTML. */}
      <div className="flex justify-end">
        <AddCityInline locale={locale} />
      </div>

      {/* Visited UIDs lead: that is the unit of fieldwork the manager tracks. Sub-stands
          sit beside it because a store with two stands is two repairs but one trip. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('totalUids')}
          value={num(overview.totals.totalUids)}
          hint={t('totalUidsHelp')}
          tone="info"
        />
        <StatCard
          label={t('subStands')}
          value={num(overview.totals.subStands)}
          hint={t('subStandsHelp')}
        />
        <StatCard label={t('totalOrdered')} value={num(overview.totals.totalOrdered)} />
        <StatCard
          label={t('successRate')}
          value={`${num(overview.totals.successRate)}٪`}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('repaired')} value={num(overview.totals.repaired)} tone="success" />
        <StatCard
          label={t('notRepaired')}
          value={num(overview.totals.notRepaired)}
          tone="danger"
        />
        <StatCard label={t('remaining')} value={num(overview.totals.remaining)} tone="warning" />
        <StatCard label={t('reRepairs')} value={num(overview.totals.reRepairs)} tone="warning" />
      </div>

      {/* §7 — Tehran vs all-other-cities vs grand total, because pay is split this way. */}
      <Card>
        <CardHeader title={t('wageSplit')} description={t('wageSplitHelp')} />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th />
                <Th>{t('repaired')}</Th>
                <Th>{t('notRepaired')}</Th>
                <Th>{t('reRepairs')}</Th>
                <Th>{t('remaining')}</Th>
                <Th>{tc('total')}</Th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [tc('tehran'), overview.split.tehran],
                  [tc('otherCities'), overview.split.otherCities],
                ] as const
              ).map(([label, bucket]) => (
                <tr key={label}>
                  <Td className="font-medium">{label}</Td>
                  <Td className="tabular-nums">{num(bucket.repaired)}</Td>
                  <Td className="tabular-nums">{num(bucket.notRepaired)}</Td>
                  <Td className="tabular-nums">{num(bucket.reRepairs)}</Td>
                  <Td className="tabular-nums">{num(bucket.remaining)}</Td>
                  <Td className="tabular-nums font-semibold">
                    {num(bucket.wageTotal)} {tc('toman')}
                  </Td>
                </tr>
              ))}
              <tr className="bg-slate-50">
                <Td className="font-bold">{tc('grandTotal')}</Td>
                <Td className="tabular-nums font-bold">{num(overview.totals.repaired)}</Td>
                <Td className="tabular-nums font-bold">{num(overview.totals.notRepaired)}</Td>
                <Td className="tabular-nums font-bold">{num(overview.totals.reRepairs)}</Td>
                <Td className="tabular-nums font-bold">{num(overview.totals.remaining)}</Td>
                <Td className="tabular-nums font-bold">
                  {num(overview.totals.wageTotal)} {tc('toman')}
                </Td>
              </tr>
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('byCity')} />
          <div className="p-1">
            {overview.cities.length === 0 ? (
              <div className="p-3">
                <EmptyState>{t('noData')}</EmptyState>
              </div>
            ) : (
              <TableWrap>
                <Table className="min-w-0">
                  <thead>
                    <tr>
                      <Th>{tc('city')}</Th>
                      <Th>{t('repaired')}</Th>
                      <Th>{t('notRepaired')}</Th>
                      <Th>{t('remaining')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.cities.map((city) => (
                      <tr key={city.cityId ?? city.cityName}>
                        <Td>
                          {city.cityName}
                          {city.isTehran ? (
                            <Badge tone="info" className="ms-2">
                              {tc('tehran')}
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="tabular-nums">{num(city.repaired)}</Td>
                        <Td className="tabular-nums">{num(city.notRepaired)}</Td>
                        <Td className="tabular-nums">{num(city.remaining)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('reasonBreakdown')} />
          <div className="p-3">
            {overview.reasons.length === 0 ? (
              <EmptyState>{t('noData')}</EmptyState>
            ) : (
              <ReasonBarChart
                data={overview.reasons.map((r) => ({
                  label: tr(r.reason),
                  value: r.count,
                }))}
              />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={t('recentForms')} />
        <div className="p-1">
          {recent.length === 0 ? (
            <div className="p-3">
              <EmptyState>{t('noData')}</EmptyState>
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
                    <Th>{tc('status')}</Th>
                    <Th>{tc('date')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((form) => (
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
                      <Td>
                        <Badge tone={form.outcome === 'REPAIRED' ? 'success' : 'danger'}>
                          {to_(form.outcome)}
                        </Badge>
                        {form.isReRepair ? (
                          <Badge tone="warning" className="ms-1">
                            ↻
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-[var(--muted)]">
                        {formatDateTimeForLocale(form.createdAt, locale)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </Card>
    </div>
  );
}
