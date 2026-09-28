import { getTranslations } from 'next-intl/server';

import { Card, CardHeader, StatCard, Table, TableWrap, Td, Th } from '@/components/ui';
import type { ClientReportCard as ReportCardData } from '@/lib/client-view';
import { formatDateTimeForLocale } from '@/lib/dates';

/**
 * Jti's report card, and the manager's identical copy of it.
 *
 * One component, rendered on both surfaces from the same data function, because the
 * entire point of this panel is that the two sides quote the same numbers. A separate
 * "manager version" would drift within a month and the first drifted figure in front of
 * a client costs more than the panel is worth.
 *
 * Two things it deliberately shows that a purely internal dashboard would not:
 *
 *  - Coverage is stated against Jti's OWN order file (ordered / done / remaining), not
 *    against work completed, because "how much of what I asked for is finished" is the
 *    only question a client opens a panel to answer.
 *  - Unsuccessful visits are broken out by reason. Three of the five reasons are Jti's
 *    own network to fix — a shut shop, a refused permission, a stand already removed —
 *    so showing them turns our excuse into their action list. Hiding them would leave
 *    104 visits looking like our failure.
 *
 * No wage, rate, cost or technician identity appears here; those never leave the server
 * (see lib/client-view.ts).
 */
export async function ClientReportCard({
  data,
  locale,
}: {
  data: ReportCardData;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'client' });
  const tr = await getTranslations({ locale, namespace: 'reasons' });

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const pct = (n: number) => {
    const rounded = (Math.round(n * 10) / 10).toLocaleString(
      locale === 'fa' ? 'fa-IR' : 'en-US',
    );
    return `${rounded}${locale === 'fa' ? '٪' : '%'}`;
  };

  const { totals } = data;

  /**
   * Progress is measured from what is LEFT, not from forms filed.
   *
   * Counting repaired + notRepaired against the order total gives over 100% — Tehran
   * read 100.9% on the first run — because the two sides count different things: a
   * location with three stands is one order line but three forms (README, "one row per
   * stand"), and a uid found in the field has no order line at all. `remaining` is the
   * count of order lines still awaiting a visit, so ordered minus remaining is the part
   * of Jti's own list that is actually dealt with, and it cannot exceed the list.
   */
  const progressOf = (ordered: number, remaining: number) =>
    ordered > 0 ? Math.min(100, ((ordered - remaining) / ordered) * 100) : null;

  const coverage = progressOf(totals.totalOrdered, totals.remaining);
  const reasonTotal = data.reasons.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          lead
          label={t('ordered')}
          value={num(totals.totalOrdered)}
          hint={t('orderedHint')}
        />
        <StatCard
          tone="success"
          label={t('repaired')}
          value={num(totals.repaired)}
          hint={t('repairedHint')}
        />
        <StatCard
          tone={totals.remaining > 0 ? 'warning' : 'neutral'}
          label={t('remaining')}
          value={num(totals.remaining)}
          hint={t('remainingHint')}
        />
        <StatCard
          tone="success"
          label={t('successRate')}
          value={pct(totals.successRate)}
          hint={t('successRateHint')}
        />
      </div>

      {/* Coverage against the order file, city by city. */}
      <Card>
        <CardHeader title={t('coverageTitle')} />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{t('city')}</Th>
                <Th className="text-end">{t('ordered')}</Th>
                <Th className="text-end">{t('repaired')}</Th>
                <Th className="text-end">{t('notRepaired')}</Th>
                <Th className="text-end">{t('reRepairs')}</Th>
                <Th className="text-end">{t('remaining')}</Th>
                <Th className="text-end">{t('done')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.cities.map((c) => {
                const cityPct = progressOf(c.totalOrdered, c.remaining);
                return (
                  <tr key={c.cityName}>
                    <Td className="font-medium">{c.cityName}</Td>
                    <Td className="text-end tabular-nums">{num(c.totalOrdered)}</Td>
                    <Td className="text-end tabular-nums text-teal-700">
                      {num(c.repaired)}
                    </Td>
                    <Td className="text-end tabular-nums text-red-700">
                      {num(c.notRepaired)}
                    </Td>
                    <Td className="text-end tabular-nums">{num(c.reRepairs)}</Td>
                    <Td className="text-end tabular-nums">{num(c.remaining)}</Td>
                    <Td className="text-end tabular-nums">
                      {cityPct === null ? '—' : pct(cityPct)}
                    </Td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-t-[var(--border)] font-bold">
                <Td>{t('total')}</Td>
                <Td className="text-end tabular-nums">{num(totals.totalOrdered)}</Td>
                <Td className="text-end tabular-nums text-teal-700">
                  {num(totals.repaired)}
                </Td>
                <Td className="text-end tabular-nums text-red-700">
                  {num(totals.notRepaired)}
                </Td>
                <Td className="text-end tabular-nums">{num(totals.reRepairs)}</Td>
                <Td className="text-end tabular-nums">{num(totals.remaining)}</Td>
                <Td className="text-end tabular-nums">
                  {coverage === null ? '—' : pct(coverage)}
                </Td>
              </tr>
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {/* Why visits produced no repair. */}
      <Card>
        <CardHeader title={t('reasonsTitle')} description={t('reasonsHelp')} />
        {data.reasons.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">{t('reasonsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {data.reasons.map((r) => {
              const share = reasonTotal > 0 ? (r.count / reasonTotal) * 100 : 0;
              return (
                <li key={r.reason} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{tr(r.reason)}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums">
                      {num(r.count)}
                      {/* Parenthesised, not merely spaced: "۴۸" beside "۴۶٫۲٪" reads as
                          one long number, and this list is read aloud in meetings. */}
                      <span className="ms-2 text-xs font-normal text-[var(--muted)]">
                        ({pct(share)})
                      </span>
                    </span>
                  </div>
                  {/* A bar rather than a number alone: the shape of this list is the
                      argument, and it should be readable at a glance in a meeting. */}
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-[var(--border)]">
                    <div
                      className="h-full rounded bg-amber-500"
                      style={{ width: `${Math.max(2, share)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Both sides need to be able to say "as of" and mean the same instant. */}
      <p className="text-xs text-[var(--muted)]">
        {t('asOf', { at: formatDateTimeForLocale(new Date(data.generatedAt), locale) })}
      </p>
    </div>
  );
}
