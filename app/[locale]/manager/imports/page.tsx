import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ManualUidsForm } from '@/components/ManualUidsForm';
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
import { Link } from '@/i18n/navigation';
import { requireManager } from '@/lib/auth';
import { formatDateForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listProjectOptions } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export default async function ImportsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/manager/imports'>) {
  const { locale } = await params;
  const sp = await searchParams;
  // Set by the delete action, which lands here because the order's own page is gone.
  const deletedName = typeof sp.deleted === 'string' ? sp.deleted : '';
  const keptForms = typeof sp.keptForms === 'string' ? Number(sp.keptForms) : 0;
  const removedForms = typeof sp.removedForms === 'string' ? Number(sp.removedForms) : 0;
  setRequestLocale(locale);
  await requireManager(locale);

  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'imports' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const [batches, cities, projects] = await Promise.all([
    prisma.importBatch.findMany({
      orderBy: { importedAt: 'desc' },
      take: 40,
      include: {
        importedBy: { select: { name: true } },
        project: { select: { name: true } },
        phase: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listProjectOptions(),
  ]);

  // Per-batch status counts in one grouped query rather than N per row.
  const statusCounts = await prisma.orderLine.groupBy({
    by: ['batchId', 'status'],
    _count: { _all: true },
  });
  const countsByBatch = new Map<string, Record<string, number>>();
  for (const row of statusCounts) {
    const entry = countsByBatch.get(row.batchId) ?? {};
    entry[row.status] = row._count._all;
    countsByBatch.set(row.batchId, entry);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>
        <Link
          href="/manager/imports/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('newImport')}
        </Link>
      </div>

      {deletedName ? (
        <Alert tone="success">
          {removedForms > 0
            ? t('orderDeletedRemovedForms', { name: deletedName, forms: removedForms })
            : keptForms > 0
              ? t('orderDeletedKeptForms', { name: deletedName, forms: keptForms })
              : t('orderDeletedNotice', { name: deletedName })}
        </Alert>
      ) : null}

      <Card>
        <CardHeader title={t('batchList')} />
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
                    <Th>{t('batchName')}</Th>
                    <Th>{tc('project')}</Th>
                    <Th>{tc('status')}</Th>
                    <Th>{t('lines')}</Th>
                    <Th>{t('done')}</Th>
                    <Th>{t('pending')}</Th>
                    <Th>{t('excluded')}</Th>
                    <Th>{t('importedBy')}</Th>
                    <Th>{tc('date')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => {
                    const counts = countsByBatch.get(batch.id) ?? {};
                    return (
                      <tr key={batch.id}>
                        <Td className="font-medium">
                          <Link
                            href={`/manager/imports/${batch.id}`}
                            className="text-brand-700 hover:underline"
                          >
                            {batch.name}
                          </Link>
                        </Td>
                        <Td className="text-xs text-[var(--muted)]">
                          {batch.project?.name ?? '—'}
                          {batch.phase ? ` · ${batch.phase.name}` : ''}
                        </Td>
                        <Td>
                          <Badge tone="info">{t(`source.${batch.source}`)}</Badge>
                        </Td>
                        <Td className="tabular-nums">{batch._count.lines}</Td>
                        <Td className="tabular-nums text-teal-700">{counts.DONE ?? 0}</Td>
                        <Td className="tabular-nums text-amber-700">{counts.PENDING ?? 0}</Td>
                        <Td className="tabular-nums text-ink-400">{counts.EXCLUDED ?? 0}</Td>
                        <Td>{batch.importedBy.name}</Td>
                        <Td className="whitespace-nowrap text-xs text-[var(--muted)]">
                          {formatDateForLocale(batch.importedAt, locale)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </Card>

      <ManualUidsForm
        locale={locale}
        cities={cities}
        projects={projects}
        orders={batches.map((b) => ({
          id: b.id,
          name: b.name,
          projectName: b.project?.name ?? null,
        }))}
      />
    </div>
  );
}
