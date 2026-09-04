import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DateRangeFilter } from '@/components/DateRangeFilter';
import { ExportPanel } from '@/components/ExportPanel';
import { ReRepairEvidencePanel } from '@/components/ReRepairEvidencePanel';
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
import { Link } from '@/i18n/navigation';
import { requireManager } from '@/lib/auth';
import {
  DAY_MS,
  RE_REPAIR_WINDOW_DAYS,
  formatDateForLocale,
  localDayRange,
} from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listProjectOptions, projectScopeWhere } from '@/lib/projects';

export const dynamic = 'force-dynamic';

/**
 * §6.3 — the separate re-repair list, plus its own Excel and evidence pack.
 *
 * "Re-repair" now means the same stand repaired twice inside ONE project. A uid that
 * recurs in a later campaign is ordinary work and stays in the main export; it is shown
 * here only as a "seen in earlier projects" marker.
 */
export default async function ReRepairsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/manager/re-repairs'>) {
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

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'reRepairs' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const [forms, cities, projects] = await Promise.all([
    prisma.repairForm.findMany({
      where: {
        isReRepair: true,
        ...projectScopeWhere(projectId, phaseId),
        ...(cityId ? { cityId } : {}),
        ...(range.from || range.to
          ? {
              date: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lt: range.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: 200,
      include: {
                city: { select: { name: true } },
        project: { select: { name: true } },
        technician: { select: { name: true, technicianCode: true } },
        parts: { include: { part: { select: { nameFa: true, nameEn: true } } } },
      },
    }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listProjectOptions(),
  ]);

  // The form each re-repair followed, so the gap between visits is visible.
  const previousIds = forms.map((f) => f.previousFormId).filter(Boolean) as string[];
  const previous = await prisma.repairForm.findMany({
    where: { id: { in: previousIds } },
    select: { id: true, date: true, formCode: true },
  });
  const previousById = new Map(previous.map((p) => [p.id, p]));

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
                    <Th>{tc('project')}</Th>
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
                            href={{
                              pathname: '/manager/uid',
                              query: { q: form.uid },
                            }}
                            className="text-brand-700 hover:underline"
                          >
                            {form.uid}
                          </Link>
                        </Td>
                        <Td className="max-w-[14rem] truncate">{form.storeName ?? '—'}</Td>
                        <Td>{form.city?.name ?? '—'}</Td>
                        <Td className="text-xs text-[var(--muted)]">
                          {form.project?.name ?? '—'}
                        </Td>
                        <Td>{form.technician.technicianCode ?? form.technician.name}</Td>
                        <Td className="whitespace-nowrap">
                          {formatDateForLocale(form.date, locale)}
                        </Td>
                        <Td className="tabular-nums">
                          {gapDays === null ? '—' : t('daysAfter', { days: gapDays })}
                          {/* 14 days is no longer the definition, only a severity signal. */}
                          {form.isQuickReRepair ? (
                            <span className="ms-1" title={t('quickHelp')}>
                              <Badge tone="danger">{t('quick')}</Badge>
                            </span>
                          ) : null}
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

      {/* The re-repair Excel and evidence live here, independent of the main exports. */}
      <h2 className="pt-2 text-base font-semibold text-brand-900">{t('exportTitle')}</h2>
      <ExportPanel
        cities={cities}
        projects={projects}
        fixedScope="RE_REPAIR"
        showPartsReport={false}
      />
      <ReRepairEvidencePanel cities={cities} />
    </div>
  );
}
