import { getTranslations, setRequestLocale } from 'next-intl/server';

import { StandHistory } from '@/components/StandHistory';
import { UidSearchBox } from '@/components/UidSearchBox';
import {
  Alert,
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
import { normaliseUid } from '@/lib/text';

export const dynamic = 'force-dynamic';

/** §6.7 / §7 — full permanent history for any uid. */
export default async function UidSearchPage({
  params,
  searchParams,
}: PageProps<'/[locale]/manager/uid'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const sp = await searchParams;
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';

  const [t, tc, ti] = await Promise.all([
    getTranslations({ locale, namespace: 'uidSearch' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'imports' }),
  ]);

  const uid = query ? normaliseUid(query) : '';

  const stand = uid
    ? await prisma.store.findUnique({
        where: { uid },
        include: {
          city: true,
          stands: { orderBy: { standIndexAtStore: 'asc' } },
          createdBy: { select: { name: true } },
          orderLines: {
            orderBy: { createdAt: 'desc' },
            include: { batch: { select: { name: true, importedAt: true, source: true } } },
          },
          repairForms: {
            orderBy: { date: 'desc' },
            include: {
              technician: { select: { name: true, technicianCode: true } },
              city: true,
              parts: { include: { part: true } },
            },
          },
        },
      })
    : null;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <UidSearchBox initial={query} />

      {query && !stand ? <Alert tone="warning">{t('notFound')}</Alert> : null}

      {stand ? (
        <>
          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="dir-ltr">{stand.uid}</span>
                  {stand.confirmation === 'PENDING' ? (
                    <Badge tone="warning">{tc('status')}: PENDING</Badge>
                  ) : null}
                  {stand.confirmation === 'REJECTED' ? (
                    <Badge tone="danger">{tc('status')}: REJECTED</Badge>
                  ) : null}
                </span>
              }
              description={t('formCount', { count: stand.repairForms.length })}
            />
            <dl className="grid gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-[var(--muted)]">{tc('store')}</dt>
                <dd className="font-medium">{stand.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">{tc('city')}</dt>
                <dd className="font-medium">{stand.city.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">{tc('phone')}</dt>
                <dd className="dir-ltr font-medium">{stand.phone ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--muted)]">{tc('address')}</dt>
                <dd>{stand.address ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">{t('standCountHeader')}</dt>
                <dd className="font-medium">{stand.stands.length}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title={t('orderHistory')} />
            <div className="p-1">
              {stand.orderLines.length === 0 ? (
                <div className="p-3">
                  <EmptyState>{tc('noResults')}</EmptyState>
                </div>
              ) : (
                <TableWrap>
                  <Table className="min-w-0">
                    <thead>
                      <tr>
                        <Th>{ti('batchName')}</Th>
                        <Th>{tc('status')}</Th>
                        <Th>{tc('city')}</Th>
                        <Th>{tc('date')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {stand.orderLines.map((line) => (
                        <tr key={line.id}>
                          <Td className="font-medium">{line.batch.name}</Td>
                          <Td>
                            <Badge
                              tone={
                                line.status === 'DONE'
                                  ? 'success'
                                  : line.status === 'EXCLUDED'
                                    ? 'neutral'
                                    : 'warning'
                              }
                            >
                              {line.status}
                            </Badge>
                            {line.isDuplicate ? (
                              <Badge tone="danger" className="ms-1">
                                ↻
                              </Badge>
                            ) : null}
                          </Td>
                          <Td>{line.cityName ?? '—'}</Td>
                          <Td className="whitespace-nowrap text-xs text-[var(--muted)]">
                            {formatDateForLocale(line.batch.importedAt, locale)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </div>
          </Card>

          <StandHistory locale={locale} history={stand.repairForms} canEdit />
        </>
      ) : null}
    </div>
  );
}
