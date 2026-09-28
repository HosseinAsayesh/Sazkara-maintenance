import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DownloadRequestForm } from '@/components/client/DownloadRequestForm';
import { DownloadRequestList } from '@/components/client/DownloadRequestList';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { isDownloadable, isExpired } from '@/lib/client-downloads';
import { getClientScope } from '@/lib/client-view';
import { prisma } from '@/lib/prisma';

/**
 * Jti reads figures on screen freely; taking a file out needs the manager to agree to
 * that specific file, each time. This is where they ask, and where they see the answer.
 */
export default async function ClientDownloadsPage({
  params,
}: PageProps<'/[locale]/client/downloads'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  // One clock reading for the whole page, so every row is judged against the same instant.
  const now = new Date();
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const [cities, requests] = await Promise.all([
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.downloadRequest.findMany({
      where: { projectId: scope.projectId, requestedById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { requestedBy: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('downloadsTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('downloadsHelp')}</p>
      </div>

      <DownloadRequestForm locale={locale} cities={cities} />

      <DownloadRequestList
        locale={locale}
        canDecide={false}
        emptyMessage={t('downloadsEmpty')}
        rows={requests.map((r) => ({
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
        }))}
      />
    </div>
  );
}
