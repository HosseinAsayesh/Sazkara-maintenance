import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Card, CardHeader, Table, TableWrap, Td, Th } from '@/components/ui';
import { requireManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * §7 — the 30-item catalogue. Read-only by design: the order of these rows IS the layout
 * of export columns 5–34, so reordering or removing one would silently change the shape
 * of every future Jti file. Adding a part is a developer change plus a migration.
 */
export default async function PartsPage({ params }: PageProps<'/[locale]/manager/parts'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, ta] = await Promise.all([
    getTranslations({ locale, namespace: 'parts' }),
    getTranslations({ locale, namespace: 'action' }),
  ]);

  const [parts, usage] = await Promise.all([
    prisma.partCatalogItem.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.partUsage.groupBy({
      by: ['partCatalogItemId', 'action'],
      _sum: { quantity: true },
    }),
  ]);

  const totals = new Map<string, { REPLACED: number; REPAIRED: number }>();
  for (const row of usage) {
    const entry = totals.get(row.partCatalogItemId) ?? { REPLACED: 0, REPAIRED: 0 };
    entry[row.action] = row._sum.quantity ?? 0;
    totals.set(row.partCatalogItemId, entry);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('title')} description={t('help')} />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t('column')}</Th>
                <Th>{t('nameFa')}</Th>
                <Th>{t('nameEn')}</Th>
                <Th>{t('replacedTotal')}</Th>
                <Th>{t('repairedTotal')}</Th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => {
                const entry = totals.get(part.id) ?? { REPLACED: 0, REPAIRED: 0 };
                return (
                  <tr key={part.id}>
                    <Td className="tabular-nums text-[var(--muted)]">{part.sortOrder}</Td>
                    <Td className="dir-ltr tabular-nums">
                      {part.exportColumnKey.replace('col', '')}
                    </Td>
                    <Td className="font-medium">{part.nameFa}</Td>
                    <Td className="dir-ltr text-[var(--muted)]">{part.nameEn}</Td>
                    <Td className="tabular-nums text-emerald-700" title={ta('REPLACED')}>
                      {entry.REPLACED}
                    </Td>
                    <Td className="tabular-nums text-brand-700" title={ta('REPAIRED')}>
                      {entry.REPAIRED}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
