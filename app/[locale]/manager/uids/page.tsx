import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DateRangeFilter } from '@/components/DateRangeFilter';
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
import { requireManager } from '@/lib/auth';
import { formatDateForLocale, localDayRange } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listProjectOptions } from '@/lib/projects';
import { listUidArchive } from '@/lib/uid-archive';

export const dynamic = 'force-dynamic';

/**
 * The UID archive: every uid touched in the filtered period, one row each, with its
 * reports summarised. Separate from the dashboard so the live counters there stay
 * readable.
 */
export default async function UidArchivePage({
  params,
  searchParams,
}: PageProps<'/[locale]/manager/uids'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const sp = await searchParams;
  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const to = typeof sp.to === 'string' ? sp.to : undefined;
  const cityId = typeof sp.cityId === 'string' ? sp.cityId : undefined;
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : undefined;
  const phaseId = typeof sp.phaseId === 'string' ? sp.phaseId : undefined;
  const query = typeof sp.q === 'string' ? sp.q : undefined;
  const range = localDayRange(from, to);

  const [t, tc, td] = await Promise.all([
    getTranslations({ locale, namespace: 'uidArchive' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'dashboard' }),
  ]);

  const [archive, cities, projects] = await Promise.all([
    listUidArchive({
      from: range.from,
      to: range.to,
      cityId,
      projectId,
      phaseId,
      query,
    }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listProjectOptions(),
  ]);

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <DateRangeFilter
        from={from}
        to={to}
        cities={cities}
        cityId={cityId}
        projects={projects}
        projectId={projectId}
        phaseId={phaseId}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={td('totalUids')} value={num(archive.totalUids)} tone="info" />
        <StatCard label={t('totalForms')} value={num(archive.totalForms)} />
      </div>

      <Card>
        <CardHeader title={t('listTitle')} description={t('help')} />
        <div className="p-1">
          {archive.rows.length === 0 ? (
            <div className="p-3">
              <EmptyState>{tc('noResults')}</EmptyState>
            </div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{tc('uid')}</Th>
                    <Th>{tc('store')}</Th>
                    <Th>{tc('city')}</Th>
                    <Th>{tc('project')}</Th>
                    <Th>{t('stands')}</Th>
                    <Th>{t('forms')}</Th>
                    <Th>{td('repaired')}</Th>
                    <Th>{td('notRepaired')}</Th>
                    <Th>{td('reRepairs')}</Th>
                    <Th>{t('partsReplaced')}</Th>
                    <Th>{t('lastVisit')}</Th>
                    <Th>{tc('technician')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {archive.rows.map((row) => (
                    <tr key={row.uid}>
                      <Td className="dir-ltr font-medium">
                        <Link
                          href={{ pathname: '/manager/uid', query: { q: row.uid } }}
                          className="text-brand-700 hover:underline"
                        >
                          {row.uid}
                        </Link>
                      </Td>
                      <Td className="max-w-[14rem] truncate">{row.storeName ?? '—'}</Td>
                      <Td>{row.cityName ?? '—'}</Td>
                      <Td className="text-xs text-[var(--muted)]">
                        {row.projectName ?? '—'}
                      </Td>
                      <Td className="tabular-nums">
                        {num(row.standCount)}
                        {row.standCount > 1 ? (
                          <Badge tone="info" className="ms-1">
                            {t('multiStand')}
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="tabular-nums">{num(row.formCount)}</Td>
                      <Td className="tabular-nums text-teal-700">{num(row.repaired)}</Td>
                      <Td className="tabular-nums text-red-700">{num(row.notRepaired)}</Td>
                      <Td className="tabular-nums text-amber-700">{num(row.reRepairs)}</Td>
                      <Td className="tabular-nums">{num(row.partsReplaced)}</Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatDateForLocale(row.lastVisit, locale)}
                      </Td>
                      <Td className="dir-ltr text-xs">
                        {row.technicianCodes.join('، ') || '—'}
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
