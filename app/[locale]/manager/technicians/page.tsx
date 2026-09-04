import { getTranslations, setRequestLocale } from 'next-intl/server';

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

  const technicians = await prisma.user.findMany({
    where: { role: 'TECHNICIAN' },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { repairForms: true } } },
  });

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
