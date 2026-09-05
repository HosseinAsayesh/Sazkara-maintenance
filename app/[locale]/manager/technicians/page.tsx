import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CrewControls } from '@/components/CrewControls';
import { ReviewTechnicianButtons } from '@/components/ReviewButtons';
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
import { formatDateForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function TechniciansPage({
  params,
}: PageProps<'/[locale]/manager/technicians'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'technicians' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  // Leads are technicians with a role flag, so they belong in the same list.
  const technicians = await prisma.user.findMany({
    where: { role: { in: ['TECHNICIAN', 'LEAD_TECHNICIAN'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { repairForms: true, crew: true } } },
  });

  const leads = technicians
    .filter((u) => u.role === 'LEAD_TECHNICIAN' && u.status === 'APPROVED')
    .map((u) => ({ id: u.id, name: u.name, technicianCode: u.technicianCode }));

  const groups = [
    { status: 'PENDING' as const, title: t('pendingTitle'), tone: 'warning' as const },
    { status: 'APPROVED' as const, title: t('approvedTitle'), tone: 'success' as const },
    { status: 'REJECTED' as const, title: t('rejectedTitle'), tone: 'danger' as const },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      {groups.map((group) => {
        const rows = technicians.filter((u) => u.status === group.status);
        return (
          <Card key={group.status}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {group.title}
                  <Badge tone={group.tone}>{rows.length}</Badge>
                </span>
              }
            />
            <div className="p-1">
              {rows.length === 0 ? (
                <div className="p-3">
                  <EmptyState>{t('empty')}</EmptyState>
                </div>
              ) : (
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>{tc('technician')}</Th>
                        <Th>{tc('phone')}</Th>
                        <Th>{t('code')}</Th>
                        <Th>{t('registeredOn')}</Th>
                        <Th>{tc('count')}</Th>
                        <Th>{t('role')}</Th>
                        <Th>{tc('actions')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((user) => (
                        <tr key={user.id}>
                          <Td className="font-medium">{user.name}</Td>
                          <Td className="dir-ltr">{user.phone}</Td>
                          <Td className="dir-ltr">{user.technicianCode ?? '—'}</Td>
                          <Td className="whitespace-nowrap text-xs text-[var(--muted)]">
                            {formatDateForLocale(user.createdAt, locale)}
                          </Td>
                          <Td className="tabular-nums">{user._count.repairForms}</Td>
                          <Td>
                            {/* Crew structure is only meaningful once approved. */}
                            {user.status === 'APPROVED' ? (
                              <CrewControls
                                locale={locale}
                                userId={user.id}
                                role={user.role as 'TECHNICIAN' | 'LEAD_TECHNICIAN'}
                                leadId={user.leadId}
                                crewSize={user._count.crew}
                                leads={leads.filter((l) => l.id !== user.id)}
                              />
                            ) : (
                              <span className="text-xs text-[var(--muted)]">—</span>
                            )}
                          </Td>
                          <Td>
                            <ReviewTechnicianButtons
                              locale={locale}
                              userId={user.id}
                              status={user.status}
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
