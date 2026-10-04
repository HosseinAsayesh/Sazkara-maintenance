import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ApproveWeeklyReport } from '@/components/WeeklyReports';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { formatDateForLocale, formatDateTimeForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Jti: the weekly reports sent for approval — open, then approve with name and signature. */
export default async function ClientWeeklyReportsPage({
  params,
}: PageProps<'/[locale]/client/weekly-reports'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireClientViewer(locale);
  const t = await getTranslations({ locale, namespace: 'weekly' });

  const reports = await prisma.weeklyReport.findMany({
    orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
    include: { project: { select: { name: true } } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('clientTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('clientHelp')}</p>
      </div>

      {reports.length === 0 ? <EmptyState>{t('none')}</EmptyState> : null}

      {reports.map((r) => (
        <Card key={r.id} className={r.status === 'APPROVED' ? '' : 'border-amber-300'}>
          <CardHeader
            title={r.title}
            description={[
              r.project?.name,
              `${t('sentOn')}: ${formatDateTimeForLocale(r.submittedAt, locale)}`,
              r.note,
            ]
              .filter(Boolean)
              .join(' · ')}
            action={
              r.status === 'APPROVED' ? (
                <Badge tone="success">{t('approved')}</Badge>
              ) : (
                <Badge tone="warning">{t('awaitingYou')}</Badge>
              )
            }
          />
          <div className="p-4">
            {r.status === 'APPROVED' ? (
              <div className="space-y-2 text-sm">
                <div>
                  {t('approvedBy', {
                    name: r.approverName ?? '',
                    date: r.approvedAt ? formatDateForLocale(r.approvedAt, locale) : '',
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/weekly-reports/${r.id}?as=xlsx`}
                    className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-brand-900 hover:bg-brand-50"
                  >
                    {t('downloadExcel')}
                  </a>
                  {r.evidenceFileRef ? (
                    <a
                      href={`/api/weekly-reports/${r.id}?as=pdf`}
                      className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-brand-900 hover:bg-brand-50"
                    >
                      {t('downloadPdf')}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <ApproveWeeklyReport
                locale={locale}
                id={r.id}
                viewed={Boolean(r.firstViewedAt)}
                hasPdf={Boolean(r.evidenceFileRef)}
                canSign={user.role === 'CLIENT_SUPERVISOR'}
              />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
