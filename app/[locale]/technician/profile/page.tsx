import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DateRangeFilter } from '@/components/DateRangeFilter';
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
import { requireTechnician } from '@/lib/auth';
import { getTechnicianStats } from '@/lib/analytics';
import { localDayRange } from '@/lib/dates';

/** §4.6 — each technician sees their own stats, by date range and city. */
export default async function TechnicianProfilePage({
  params,
  searchParams,
}: PageProps<'/[locale]/technician/profile'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireTechnician(locale);
  const sp = await searchParams;
  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const to = typeof sp.to === 'string' ? sp.to : undefined;
  const range = localDayRange(from, to);

  const [t, tc, tr] = await Promise.all([
    getTranslations({ locale, namespace: 'technician' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'reasons' }),
  ]);

  const stats = await getTechnicianStats(user.id, { from: range.from, to: range.to });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('profileTitle')}</h1>

      <DateRangeFilter from={from} to={to} />

      {/* Wages are deliberately absent: technicians see their workload, not their
          earnings. The figures still exist server-side for the manager's split. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('stats.repaired')} value={stats.repaired} tone="success" />
        <StatCard label={t('stats.notRepaired')} value={stats.notRepaired} tone="danger" />
        <StatCard label={t('stats.reRepairs')} value={stats.reRepairs} tone="warning" />
        <StatCard label={t('stats.totalVisits')} value={stats.totalVisits} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={tc('city')} />
          <div className="p-3">
            {stats.perCity.length === 0 ? (
              <EmptyState>{tc('noResults')}</EmptyState>
            ) : (
              <TableWrap>
                <Table className="min-w-0">
                  <thead>
                    <tr>
                      <Th>{tc('city')}</Th>
                      <Th>{t('stats.repaired')}</Th>
                      <Th>{t('stats.notRepaired')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.perCity.map((row) => (
                      <tr key={row.cityName}>
                        <Td>{row.cityName}</Td>
                        <Td className="tabular-nums">{row.repaired}</Td>
                        <Td className="tabular-nums">{row.notRepaired}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('stats.notRepaired')} />
          <div className="p-3">
            {stats.reasons.length === 0 ? (
              <EmptyState>{tc('noResults')}</EmptyState>
            ) : (
              <ul className="space-y-2">
                {stats.reasons.map((r) => (
                  <li
                    key={r.reason}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    <span>{tr(r.reason)}</span>
                    <span className="font-semibold tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
