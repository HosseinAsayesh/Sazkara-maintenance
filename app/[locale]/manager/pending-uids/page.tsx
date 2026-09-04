import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReviewStandButtons } from '@/components/ReviewButtons';
import {
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
import { formatDateForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** §6.2 — the single place stray uids are admitted to the official record. */
export default async function PendingUidsPage({
  params,
}: PageProps<'/[locale]/manager/pending-uids'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'pendingUids' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const stands = await prisma.stand.findMany({
    where: { confirmation: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: {
      store: { include: { city: true } },
      createdBy: { select: { name: true, technicianCode: true } },
      _count: { select: { repairForms: true } },
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('title')} description={t('help')} />
        <div className="p-1">
          {stands.length === 0 ? (
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
                    <Th>{t('addedBy')}</Th>
                    <Th>{t('addedOn')}</Th>
                    <Th>{tc('count')}</Th>
                    <Th>{tc('actions')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {stands.map((stand) => (
                    <tr key={stand.id}>
                      <Td className="dir-ltr font-medium">
                        <Link
                          href={{ pathname: '/manager/uid', query: { q: stand.uid } }}
                          className="text-brand-700 hover:underline"
                        >
                          {stand.uid}
                        </Link>
                      </Td>
                      <Td className="max-w-[16rem] truncate">{stand.store?.name ?? '—'}</Td>
                      <Td>{stand.store?.city.name ?? '—'}</Td>
                      <Td>
                        {stand.createdBy
                          ? `${stand.createdBy.name}${
                              stand.createdBy.technicianCode
                                ? ` (${stand.createdBy.technicianCode})`
                                : ''
                            }`
                          : '—'}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-[var(--muted)]">
                        {formatDateForLocale(stand.createdAt, locale)}
                      </Td>
                      <Td className="tabular-nums">{stand._count.repairForms}</Td>
                      <Td>
                        <ReviewStandButtons locale={locale} standId={stand.id} />
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
