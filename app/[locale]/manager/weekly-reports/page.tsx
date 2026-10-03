import { getTranslations, setRequestLocale } from 'next-intl/server';

import { WeeklyReportForm, WithdrawWeeklyReport } from '@/components/WeeklyReports';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';
import { requireManager } from '@/lib/auth';
import { formatDateForLocale, formatDateTimeForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listProjectOptions } from '@/lib/projects';

export const dynamic = 'force-dynamic';

/** Weekly reports sent to Jti for approval, and the form that sends the next one. */
export default async function WeeklyReportsPage({
  params,
}: PageProps<'/[locale]/manager/weekly-reports'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'weekly' });

  const [projects, reports] = await Promise.all([
    listProjectOptions(),
    prisma.weeklyReport.findMany({
      orderBy: { submittedAt: 'desc' },
      include: { project: { select: { name: true } } },
    }),
  ]);
  const active = projects.find((p) => p.isActive);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <WeeklyReportForm
        locale={locale}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        defaultProjectId={active?.id ?? ''}
      />

      <Card>
        <CardHeader title={t('listTitle')} />
        <div className="p-1">
          {reports.length === 0 ? (
            <div className="p-3">
              <EmptyState>{t('none')}</EmptyState>
            </div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('report')}</Th>
                    <Th>{t('sentOn')}</Th>
                    <Th>{t('status')}</Th>
                    <Th>{t('approval')}</Th>
                    <Th>{t('files')}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <div className="font-medium">{r.title}</div>
                        <div className="text-xs text-[var(--muted)]">
                          {r.project?.name ?? '—'} ·{' '}
                          {r.source === 'GENERATED' ? t('modeGenerate') : t('modeUpload')}
                        </div>
                        {r.note ? <div className="mt-1 text-xs">{r.note}</div> : null}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatDateTimeForLocale(r.submittedAt, locale)}
                      </Td>
                      <Td>
                        {r.status === 'APPROVED' ? (
                          <Badge tone="success">{t('approved')}</Badge>
                        ) : r.firstViewedAt ? (
                          <Badge tone="warning">{t('seenAwaiting')}</Badge>
                        ) : (
                          <Badge tone="neutral">{t('awaiting')}</Badge>
                        )}
                      </Td>
                      <Td className="text-xs">
                        {r.status === 'APPROVED' ? (
                          <div className="space-y-1">
                            <div className="font-medium">{r.approverName}</div>
                            <div className="text-[var(--muted)]">
                              {r.approvedAt ? formatDateForLocale(r.approvedAt, locale) : ''}
                            </div>
                            {r.approverSignatureRef ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/weekly-reports/${r.id}?as=signature`}
                                alt={t('signature')}
                                className="h-10 w-auto rounded border border-[var(--border)] bg-white"
                              />
                            ) : null}
                          </div>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-sm">
                        <a
                          href={`/api/weekly-reports/${r.id}?as=xlsx`}
                          className="text-brand-700 hover:underline"
                        >
                          Excel
                        </a>
                        {' · '}
                        <a
                          href={`/api/weekly-reports/${r.id}?as=pdf`}
                          className="text-brand-700 hover:underline"
                        >
                          PDF
                        </a>
                      </Td>
                      <Td>
                        {r.status !== 'APPROVED' ? (
                          <WithdrawWeeklyReport locale={locale} id={r.id} />
                        ) : null}
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
