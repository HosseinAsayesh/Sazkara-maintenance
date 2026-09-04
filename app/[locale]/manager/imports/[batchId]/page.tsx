import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { OrderEditor, type OrderLineRow } from '@/components/OrderEditor';
import { requireManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listProjectOptions } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({
  params,
}: PageProps<'/[locale]/manager/imports/[batchId]'>) {
  const { locale, batchId } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { lines: { orderBy: { createdAt: 'asc' } } },
  });
  if (!batch) notFound();

  const projects = await listProjectOptions();

  // Which uids already carry fieldwork — those rows are protected from deletion.
  // Resolved in one query rather than per row.
  const uids = batch.lines.map((l) => l.uid);
  const reported = uids.length
    ? await prisma.repairForm.findMany({
        where: { stand: { uid: { in: uids } } },
        select: { stand: { select: { uid: true } } },
        distinct: ['standId'],
      })
    : [];
  const reportedUids = new Set(reported.map((r) => r.stand.uid));

  const lines: OrderLineRow[] = batch.lines.map((line) => ({
    id: line.id,
    uid: line.uid,
    storeName: line.storeName,
    address: line.address,
    digitalAddress: line.digitalAddress,
    managerName: line.managerName,
    phone: line.phone,
    cityName: line.cityName,
    status: line.status,
    isDuplicate: line.isDuplicate,
    duplicateNote: line.duplicateNote,
    hasForms: reportedUids.has(line.uid),
  }));

  return (
    <OrderEditor
      locale={locale}
      batchId={batch.id}
      batchName={batch.name}
      lines={lines}
      projects={projects.map((p) => ({ id: p.id, name: p.name, phases: p.phases }))}
      currentProjectId={batch.projectId}
      currentPhaseId={batch.phaseId}
    />
  );
}
