import { getTranslations } from 'next-intl/server';

import { Card, CardHeader, StatCard, Table, TableWrap, Td, Th } from '@/components/ui';
import type { PartsUsageReport } from '@/lib/exports/parts-usage';
import { CENTIMETER_PARTS, CENTIMETER_STEP } from '@/lib/parts';

/**
 * Parts consumed across the campaign: how many, and how often a stand needed them.
 *
 * Only REPLACED parts appear (§6.8) — a part repaired in place is not consumed
 * inventory, and mixing the two would inflate a figure the client reads as a bill.
 *
 * The column that earns its place is "share of stands": 740 fuses across 698 stands
 * means nearly every stand needed one, which is a fact about how these stands fail, not
 * about how many fuses we bought. That is the number worth a conversation.
 */
export async function ClientPartsTable({
  report,
  locale,
}: {
  report: PartsUsageReport;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'client' });

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const pct = (n: number) => {
    const rounded = (Math.round(n * 10) / 10).toLocaleString(
      locale === 'fa' ? 'fa-IR' : 'en-US',
    );
    return `${rounded}${locale === 'fa' ? '٪' : '%'}`;
  };

  // A catalogue of thirty where half were never touched is mostly noise on a page the
  // client skims, so unused parts drop out and are counted in a footnote instead.
  const used = report.rows
    .filter((r) => r.total > 0)
    .sort((a, b) => b.standCount - a.standCount || b.total - a.total);
  const unused = report.rows.length - used.length;

  /**
   * The SMD strips are cut from a reel and recorded in centimetres, so their raw
   * quantity dwarfs everything else: 23,137 next to 740 fuses reads as though the reel
   * were the main thing consumed. Counted in the 50 cm cuts they are actually fitted in,
   * the same figure is 463 — a number that sits sensibly beside the rest.
   *
   * The centimetres are still shown on the row, because that is what was recorded and
   * what a parts bill is reconciled against.
   */
  const isCut = (nameFa: string) => CENTIMETER_PARTS.has(nameFa);
  const inCuts = (row: { nameFa: string; total: number }) =>
    isCut(row.nameFa) ? Math.round(row.total / CENTIMETER_STEP) : row.total;
  const totalItems = used.reduce((sum, r) => sum + inCuts(r), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          lead
          label={t('partsDistinct')}
          value={num(used.length)}
          hint={t('partsDistinctHint')}
        />
        <StatCard
          label={t('partsRepairedStands')}
          value={num(report.repairedStandCount)}
          hint={t('partsRepairedStandsHint')}
        />
        <StatCard
          label={t('partsGrandTotal')}
          value={num(totalItems)}
          hint={t('partsGrandTotalHint')}
        />
      </div>

      <Card>
        <CardHeader title={t('partsTitle')} description={t('partsHelp')} />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{t('part')}</Th>
                <Th numeric>{t('partTotal')}</Th>
                <Th numeric>{t('partStands')}</Th>
                <Th numeric>{t('partShare')}</Th>
              </tr>
            </thead>
            <tbody>
              {used.map((row) => {
                const share =
                  report.repairedStandCount > 0
                    ? (row.standCount / report.repairedStandCount) * 100
                    : 0;
                return (
                  <tr key={row.partId}>
                    <Td className="font-medium">
                      {locale === 'fa' ? row.nameFa : row.nameEn}
                    </Td>
                    <Td numeric>
                      {num(inCuts(row))}
                      {isCut(row.nameFa) ? (
                        <span className="ms-1 text-xs font-normal text-[var(--muted)]">
                          ({t('cmTotal', { n: num(row.total) })})
                        </span>
                      ) : null}
                    </Td>
                    <Td numeric>{num(row.standCount)}</Td>
                    <Td numeric>{pct(share)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
        {unused > 0 ? (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
            {t('partsUnused', { n: num(unused) })}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
