import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DateRangeFilter } from '@/components/DateRangeFilter';
import { WorkExportPanel } from '@/components/WorkExportPanel';
import {
  Alert,
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
import { requireLead } from '@/lib/auth';
import { formatDateForLocale, localDayRange } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listProjectOptions, projectScopeWhere } from '@/lib/projects';

export const dynamic = 'force-dynamic';

/**
 * What a crew lead needs: who is on the crew, what they have filed, and a spreadsheet to
 * pass upward. Wages are absent by design — a lead has no authority over rates or
 * expenses, and technicians do not see their earnings either.
 */
export default async function LeadDashboard({
  params,
  searchParams,
}: PageProps<'/[locale]/lead'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireLead(locale);

  const sp = await searchParams;
  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const to = typeof sp.to === 'string' ? sp.to : undefined;
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : undefined;
  const phaseId = typeof sp.phaseId === 'string' ? sp.phaseId : undefined;
  const range = localDayRange(from, to);

  const [t, tc, td, to_] = await Promise.all([
    getTranslations({ locale, namespace: 'lead' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'dashboard' }),
    getTranslations({ locale, namespace: 'outcome' }),
  ]);

  // A manager viewing this page has no crew of their own, so they see every technician —
  // otherwise the page would look broken to them.
  const crew = await prisma.user.findMany({
    where:
      user.role === 'MANAGER'
        ? { role: 'TECHNICIAN', status: 'APPROVED' }
        : { leadId: user.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, technicianCode: true, status: true },
  });

  const crewIds = crew.map((c) => c.id);

  const where = {
    ...(crewIds.length ? { technicianId: { in: crewIds } } : { technicianId: user.id }),
    ...projectScopeWhere(projectId, phaseId),
    ...(range.from || range.to
      ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lt: range.to } : {}),
          },
        }
      : {}),
  };

  const [forms, projects] = await Promise.all([
    prisma.repairForm.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 100,
      include: {
        technician: { select: { name: true, technicianCode: true } },
        city: { select: { name: true } },
      },
    }),
    listProjectOptions(),
  ]);

  // Per-member tallies for the range, computed from the same rows the table shows.
  const all = await prisma.repairForm.findMany({
    where,
    select: { technicianId: true, outcome: true, isReRepair: true, uid: true },
  });

  const tally = new Map(
    crew.map((c) => [
      c.id,
      { repaired: 0, reRepairs: 0, notRepaired: 0, uids: new Set<string>() },
    ]),
  );
  for (const f of all) {
    const row = tally.get(f.technicianId);
    if (!row) continue;
    row.uids.add(f.uid);
    if (f.outcome === 'REPAIRED') {
      if (f.isReRepair) row.reRepairs++;
      else row.repaired++;
    } else {
      row.notRepaired++;
    }
  }

  const totals = {
    repaired: all.filter((f) => f.outcome === 'REPAIRED' && !f.isReRepair).length,
    reRepairs: all.filter((f) => f.isReRepair).length,
    notRepaired: all.filter((f) => f.outcome === 'NOT_REPAIRED').length,
    uids: new Set(all.map((f) => f.uid)).size,
  };

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <Alert tone="info">{t('scopeNote')}</Alert>

      <DateRangeFilter
        from={from}
        to={to}
        projects={projects}
        projectId={projectId}
        phaseId={phaseId}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={td('totalUids')} value={num(totals.uids)} tone="info" />
        <StatCard label={td('repaired')} value={num(totals.repaired)} tone="success" />
        <StatCard label={td('notRepaired')} value={num(totals.notRepaired)} tone="danger" />
        <StatCard label={td('reRepairs')} value={num(totals.reRepairs)} tone="warning" />
      </div>

      <Card>
        <CardHeader title={t('crew')} description={t('crewHelp')} />
        <div className="p-1">
          {crew.length === 0 ? (
            <div className="p-3">
              <EmptyState>{t('noCrew')}</EmptyState>
            </div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{tc('technician')}</Th>
                    <Th>{td('totalUids')}</Th>
                    <Th>{td('repaired')}</Th>
                    <Th>{td('reRepairs')}</Th>
                    <Th>{td('notRepaired')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {crew.map((member) => {
                    const row = tally.get(member.id);
                    return (
                      <tr key={member.id}>
                        <Td>
                          <span className="font-medium">{member.name}</span>
                          {member.technicianCode ? (
                            <span className="ms-2 text-xs text-[var(--muted)] dir-ltr">
                              {member.technicianCode}
                            </span>
                          ) : null}
                        </Td>
                        <Td className="tabular-nums">{num(row?.uids.size ?? 0)}</Td>
                        <Td className="tabular-nums">{num(row?.repaired ?? 0)}</Td>
                        <Td className="tabular-nums">{num(row?.reRepairs ?? 0)}</Td>
                        <Td className="tabular-nums">{num(row?.notRepaired ?? 0)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </Card>

      <WorkExportPanel projects={projects} crew={crew} />

      <Card>
        <CardHeader title={t('recent')} />
        <div className="p-1">
          {forms.length === 0 ? (
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
                    <Th>{tc('technician')}</Th>
                    <Th>{tc('status')}</Th>
                    <Th>{tc('date')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((form) => (
                    <tr key={form.id}>
                      <Td className="dir-ltr font-medium">
                        {form.uid}
                        {form.standIndex > 1 ? (
                          <span className="ms-1 text-xs text-[var(--muted)]">
                            #{form.standIndex}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="max-w-[14rem] truncate">{form.storeName ?? '—'}</Td>
                      <Td>{form.city?.name ?? '—'}</Td>
                      <Td>{form.technician.technicianCode ?? form.technician.name}</Td>
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
                        {formatDateForLocale(form.date, locale)}
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
