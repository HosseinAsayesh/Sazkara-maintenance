import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DownloadRequestList } from '@/components/client/DownloadRequestList';
import { requireManager } from '@/lib/auth';
import { isDownloadable, isExpired } from '@/lib/client-downloads';
import { prisma } from '@/lib/prisma';

/**
 * The manager's side of the gate.
 *
 * Pending first, because that is the only part that needs a decision; decided requests
 * stay below as the record of what was released and what was refused, which is the
 * thing that settles an argument later.
 */
export default async function ManagerDownloadRequestsPage({
  params,
}: PageProps<'/[locale]/manager/download-requests'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'client' });

  // One clock reading for the whole page, so every row is judged against the same instant.
  const now = new Date();

  const requests = await prisma.downloadRequest.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: { requestedBy: { select: { name: true } } },
  });

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING');

  const toRow = (r: (typeof requests)[number]) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    reason: r.reason,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    expiresAt: r.expiresAt,
    downloadedAt: r.downloadedAt,
    fileRef: r.fileRef,
    requestedByName: r.requestedBy.name,
    expired: isExpired(r, now),
    downloadable: isDownloadable(r) && !isExpired(r, now),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('reviewTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('reviewHelp')}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-900">{t('reviewPending')}</h2>
        <DownloadRequestList
          locale={locale}
          canDecide
          emptyMessage={t('reviewNoPending')}
          rows={pending.map(toRow)}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-900">{t('reviewDecided')}</h2>
        <DownloadRequestList
          locale={locale}
          canDecide={false}
          emptyMessage={t('reviewNoDecided')}
          rows={decided.map(toRow)}
        />
      </section>
    </div>
  );
}
