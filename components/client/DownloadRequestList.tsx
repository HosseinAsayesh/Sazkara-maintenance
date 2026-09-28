import { getTranslations } from 'next-intl/server';

import { Badge, EmptyState, Table, TableWrap, Td, Th } from '@/components/ui';
import { formatDateTimeForLocale } from '@/lib/dates';

import { DownloadRequestReview } from './DownloadRequestReview';

export interface DownloadRequestRow {
  id: string;
  kind: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  reason: string;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
  downloadedAt: Date | null;
  fileRef: string | null;
  requestedByName: string;
  /** Decided by the page, not while rendering. */
  expired: boolean;
  /** Likewise: whether the download link should be offered at all. */
  downloadable: boolean;
}

/**
 * One table for both sides of the gate: Jti sees the state of what they asked for, the
 * manager sees the same rows with approve/deny attached.
 *
 * Shared deliberately. A separate manager table would be free to show a request Jti
 * cannot see they made, and the whole point of this feature is that both parties are
 * looking at one list.
 */
export async function DownloadRequestList({
  rows,
  locale,
  canDecide,
  emptyMessage,
}: {
  rows: DownloadRequestRow[];
  locale: string;
  /** Manager view: renders the decision controls and the requester's name. */
  canDecide: boolean;
  emptyMessage: string;
}) {
  const t = await getTranslations({ locale, namespace: 'client' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  if (rows.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  const kindLabel = (kind: string) =>
    kind === 'JTI_EXPORT_MAIN'
      ? t('kindMain')
      : kind === 'JTI_EXPORT_REREPAIRS'
        ? t('kindReRepairs')
        : kind === 'PARTS_USAGE_REPORT'
          ? t('kindParts')
          : t('kindEvidence');

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{t('requestKind')}</Th>
            {canDecide ? <Th>{t('requestedBy')}</Th> : null}
            <Th>{t('requestReason')}</Th>
            <Th>{tc('status')}</Th>
            <Th>{tc('actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expired = row.expired;

            return (
              <tr key={row.id}>
                <Td className="whitespace-nowrap font-medium">
                  {kindLabel(row.kind)}
                  <div className="text-xs font-normal text-[var(--muted)]">
                    {formatDateTimeForLocale(row.createdAt, locale)}
                  </div>
                </Td>
                {canDecide ? (
                  <Td className="whitespace-nowrap">{row.requestedByName}</Td>
                ) : null}
                <Td className="max-w-[20rem] text-sm">{row.reason}</Td>
                <Td className="whitespace-nowrap">
                  {row.status === 'PENDING' ? (
                    <Badge tone="warning">{t('statusPending')}</Badge>
                  ) : row.status === 'DENIED' ? (
                    <span className="flex flex-col gap-0.5">
                      <Badge tone="danger">{t('statusDenied')}</Badge>
                      {row.decisionNote ? (
                        <span className="text-xs text-[var(--muted)]">
                          {row.decisionNote}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      <Badge tone={expired ? 'neutral' : 'success'}>
                        {expired ? t('statusExpired') : t('statusApproved')}
                      </Badge>
                      {row.expiresAt ? (
                        <span className="text-xs text-[var(--muted)]">
                          {t('expiresAt', {
                            at: formatDateTimeForLocale(row.expiresAt, locale),
                          })}
                        </span>
                      ) : null}
                      {row.downloadedAt ? (
                        <span className="text-xs text-[var(--muted)]">
                          {t('downloadedAt', {
                            at: formatDateTimeForLocale(row.downloadedAt, locale),
                          })}
                        </span>
                      ) : null}
                    </span>
                  )}
                </Td>
                <Td>
                  {row.status === 'PENDING' && canDecide ? (
                    <DownloadRequestReview locale={locale} requestId={row.id} />
                  ) : row.downloadable ? (
                    // A plain link, not a fetch: the browser saves the file and the
                    // route re-checks approval, so the URL is safe on its own.
                    <a
                      className="font-medium text-teal-700 hover:underline"
                      href={`/api/client-downloads/${row.id}`}
                    >
                      {tc('download')}
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}
