import { getTranslations } from 'next-intl/server';

import { Badge, EmptyState, Table, TableWrap, Td, Th } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { ClientFormRow } from '@/lib/client-view';
import { formatDateForLocale } from '@/lib/dates';

/**
 * The one table behind Jti's "today", "reports" and "re-repairs" tabs.
 *
 * Written once on purpose: three tables would be three chances for one of them to grow
 * a column the others withhold. What Jti may see is decided in lib/client-view.ts and
 * rendered here, and nowhere else.
 *
 * There is no technician column. That is not an oversight — the client is shown the
 * work, never who did it.
 */
export async function ClientFormsTable({
  rows,
  locale,
  emptyMessage,
}: {
  rows: ClientFormRow[];
  locale: string;
  emptyMessage: string;
}) {
  const t = await getTranslations({ locale, namespace: 'client' });
  const tr = await getTranslations({ locale, namespace: 'reasons' });
  const tf = await getTranslations({ locale, namespace: 'form' });

  if (rows.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const partName = (p: ClientFormRow['parts'][number]) =>
    locale === 'fa' ? p.nameFa : p.nameEn;

  /** «تعویض: فیوز ×۱ — تعمیر: کلید ×۱». Replaced first: it is the billed half. */
  const describeParts = (row: ClientFormRow) => {
    const replaced = row.parts.filter((p) => p.action === 'REPLACED');
    const repaired = row.parts.filter((p) => p.action === 'REPAIRED');
    const segments: string[] = [];
    if (replaced.length) {
      segments.push(
        `${tf('replacedParts')}: ${replaced
          .map((p) => `${partName(p)} ×${num(p.quantity)}`)
          .join('، ')}`,
      );
    }
    if (repaired.length) {
      segments.push(
        `${tf('repairedParts')}: ${repaired
          .map((p) => `${partName(p)} ×${num(p.quantity)}`)
          .join('، ')}`,
      );
    }
    return segments.join(' — ');
  };

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{t('formCode')}</Th>
            <Th>{t('date')}</Th>
            <Th>{t('uid')}</Th>
            <Th>{t('store')}</Th>
            <Th>{t('city')}</Th>
            <Th>{t('outcome')}</Th>
            <Th>{t('parts')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td className="whitespace-nowrap font-medium dir-ltr">
                {/* The form code is the way into one visit and its question thread. */}
                <Link
                  href={`/client/form/${row.id}`}
                  className="text-teal-700 hover:underline"
                >
                  {row.formCode}
                </Link>
                {row.isReRepair ? (
                  <Badge tone="warning" className="ms-2">
                    {t('reRepairBadge')}
                  </Badge>
                ) : null}
                {row.queryCount > 0 ? (
                  <Badge tone="info" className="ms-2">
                    {t('queryBadge', { n: num(row.queryCount) })}
                  </Badge>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">{formatDateForLocale(row.date, locale)}</Td>
              <Td className="whitespace-nowrap dir-ltr">
                {row.uid}
                {/* Several stands share one uid, so the position is part of the identity. */}
                {row.standIndex > 1 ? (
                  <span className="ms-1 text-xs text-[var(--muted)]">
                    #{num(row.standIndex)}
                  </span>
                ) : null}
              </Td>
              <Td className="max-w-[16rem] truncate">{row.storeName}</Td>
              <Td className="whitespace-nowrap">{row.cityName}</Td>
              <Td className="whitespace-nowrap">
                {row.outcome === 'REPAIRED' ? (
                  <Badge tone="success">{t('outcomeRepaired')}</Badge>
                ) : (
                  <span className="flex flex-col gap-0.5">
                    <Badge tone="danger">{t('outcomeNotRepaired')}</Badge>
                    {row.notRepairedReason ? (
                      <span className="text-xs text-[var(--muted)]">
                        {tr(row.notRepairedReason)}
                      </span>
                    ) : null}
                  </span>
                )}
              </Td>
              <Td className="text-xs text-[var(--muted)]">{describeParts(row) || '—'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
