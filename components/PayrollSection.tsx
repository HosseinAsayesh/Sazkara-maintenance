import { getTranslations } from 'next-intl/server';

import { DateRangeFilter } from '@/components/DateRangeFilter';
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';
import { localDayRange } from '@/lib/dates';
import { HISTORICAL_TECHNICIAN_PHONE } from '@/lib/historical';
import { getPayroll, readPayrollParams } from '@/lib/payroll';
import { prisma } from '@/lib/prisma';
import { listProjectOptions } from '@/lib/projects';

/**
 * Technician payments for the filtered period. Server-rendered from the same filters as
 * every other manager view, plus technician and the re-repair choice.
 */
export async function PayrollSection({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = readPayrollParams(searchParams);
  const range = localDayRange(params.from, params.to);

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'payroll' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const [payroll, cities, projects, technicians] = await Promise.all([
    getPayroll({ ...params, from: range.from, to: range.to }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listProjectOptions(),
    prisma.user.findMany({
      where: {
        role: { in: ['TECHNICIAN', 'LEAD_TECHNICIAN'] },
        status: 'APPROVED',
        phone: { not: HISTORICAL_TECHNICIAN_PHONE },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, technicianCode: true },
    }),
  ]);

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const money = (n: number) => `${num(Math.round(n))} ${tc('toman')}`;

  // The export repeats exactly what is on screen.
  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'cityId', 'projectId', 'phaseId', 'technicianId', 'reRepairs']) {
    const v = searchParams[key];
    if (typeof v === 'string' && v) query.set(key, v);
  }

  const totals = payroll.totals;

  return (
    <div className="space-y-4">
      <DateRangeFilter
        from={params.from}
        to={params.to}
        cities={cities}
        cityId={params.cityId}
        projects={projects}
        projectId={params.projectId}
        phaseId={params.phaseId}
        selects={[
          {
            name: 'technicianId',
            label: tc('technician'),
            value: params.technicianId ?? '',
            options: [
              { value: '', label: tc('all') },
              ...technicians.map((u) => ({
                value: u.id,
                label: u.technicianCode ? `${u.name} (${u.technicianCode})` : u.name,
              })),
            ],
          },
          {
            name: 'reRepairs',
            label: t('reRepairsFilter'),
            value: params.includeReRepairs ? '' : 'exclude',
            options: [
              { value: '', label: t('reRepairsInclude') },
              { value: 'exclude', label: t('reRepairsExclude') },
            ],
          },
        ]}
      />

      {!params.from && !params.to ? <Alert tone="info">{t('allTimeHint')}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('totalPayable')} value={money(totals.total)} tone="success" />
        <StatCard
          label={t('repairedStands')}
          value={num(totals.firstStands + totals.secondStands + totals.thirdPlusStands)}
          tone="info"
        />
        <StatCard label={t('unrepairedVisits')} value={num(totals.unrepairedVisits)} />
        <StatCard
          label={t('reRepairs')}
          value={num(totals.reRepairs)}
          hint={
            params.includeReRepairs
              ? t('reRepairsCounted', { amount: money(totals.reRepairAmount) })
              : t('reRepairsNotCounted', { amount: money(totals.reRepairAmount) })
          }
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader
          title={t('tableTitle')}
          description={t('tableHelp')}
          action={
            <a
              href={`/api/manager/exports/payroll?${query.toString()}`}
              className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-brand-900 hover:bg-brand-50"
            >
              {t('download')}
            </a>
          }
        />
        <div className="p-1">
          {payroll.rows.length === 0 ? (
            <div className="p-3">
              <EmptyState>{tc('noResults')}</EmptyState>
            </div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{tc('technician')}</Th>
                    <Th>{t('code')}</Th>
                    <Th>{t('firstStands')}</Th>
                    <Th>{t('secondStands')}</Th>
                    <Th>{t('thirdPlusStands')}</Th>
                    <Th>{t('unrepairedVisits')}</Th>
                    <Th>{t('reRepairs')}</Th>
                    <Th>{t('payable')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.rows.map((r) => (
                    <tr key={r.technicianId}>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="dir-ltr text-xs">{r.code || '—'}</Td>
                      <Td className="tabular-nums">{num(r.firstStands)}</Td>
                      <Td className="tabular-nums">{num(r.secondStands)}</Td>
                      <Td className="tabular-nums">{num(r.thirdPlusStands)}</Td>
                      <Td className="tabular-nums">{num(r.unrepairedVisits)}</Td>
                      <Td className="tabular-nums text-amber-700">
                        {num(r.reRepairs)}
                        {r.reRepairs ? (
                          <span
                            className={
                              params.includeReRepairs
                                ? 'ms-1 text-xs'
                                : 'ms-1 text-xs text-[var(--muted)] line-through'
                            }
                          >
                            ({money(r.reRepairAmount)})
                          </span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap font-semibold tabular-nums text-teal-800">
                        {money(r.total)}
                      </Td>
                    </tr>
                  ))}
                  <tr className="bg-brand-50 font-semibold">
                    <Td>{tc('total')}</Td>
                    <Td />
                    <Td className="tabular-nums">{num(totals.firstStands)}</Td>
                    <Td className="tabular-nums">{num(totals.secondStands)}</Td>
                    <Td className="tabular-nums">{num(totals.thirdPlusStands)}</Td>
                    <Td className="tabular-nums">{num(totals.unrepairedVisits)}</Td>
                    <Td className="tabular-nums">{num(totals.reRepairs)}</Td>
                    <Td className="whitespace-nowrap tabular-nums text-teal-800">
                      {money(totals.total)}
                    </Td>
                  </tr>
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </Card>
    </div>
  );
}
