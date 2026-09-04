import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EvidenceGenerator } from '@/components/EvidenceGenerator';
import {
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
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function EvidencePage({ params }: PageProps<'/[locale]/manager/evidence'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'evidence' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const [cities, batches] = await Promise.all([
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.evidencePdfBatch.findMany({
      orderBy: [{ date: 'desc' }, { generatedAt: 'desc' }],
      take: 50,
      include: { city: { select: { name: true } } },
    }),
  ]);

  const storage = getStorage();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>

      <EvidenceGenerator locale={locale} cities={cities} />

      <Card>
        <CardHeader title={t('cachedList')} />
        <div className="p-1">
          {batches.length === 0 ? (
            <div className="p-3">
              <EmptyState>{tc('noResults')}</EmptyState>
            </div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{tc('date')}</Th>
                    <Th>{tc('city')}</Th>
                    <Th>{tc('count')}</Th>
                    <Th>{t('generatedAtHeader')}</Th>
                    <Th>{tc('actions')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <Td className="whitespace-nowrap">
                        {formatDateForLocale(batch.date, locale)}
                      </Td>
                      <Td>{batch.city.name}</Td>
                      <Td className="tabular-nums">{batch.standCount}</Td>
                      <Td className="whitespace-nowrap text-xs text-[var(--muted)]">
                        {formatDateTimeForLocale(batch.generatedAt, locale)}
                      </Td>
                      <Td>
                        <a
                          href={storage.url(batch.fileRef)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-brand-700 hover:underline"
                        >
                          {tc('download')}
                        </a>
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
