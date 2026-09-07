import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import {
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
import { getBreakdown, isBreakdownMetric } from '@/lib/breakdown';
import { formatDateForLocale, localDayRange } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

/**
 * The list behind a dashboard figure.
 *
 * It exists for one question the manager could not previously answer: an order goes out
 * with a hundred uids and ninety-five come back — which five are missing? Clicking
 * «باقی‌مانده» lists them by uid, store and city, which is what it takes to chase them.
 *
 * The dashboard's filters travel in the query string so the list is scoped to whatever
 * the manager was looking at, and never shows a different population than the number
 * they clicked.
 */
export const dynamic = 'force-dynamic';

export default async function BreakdownPage({
  params,
  searchParams,
}: PageProps<'/[locale]/manager/breakdown'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const sp = await searchParams;
  const metric = typeof sp.metric === 'string' ? sp.metric : '';
  if (!isBreakdownMetric(metric)) notFound();

  const from = typeof sp.from === 'string' ? sp.from : undefined;
  const to = typeof sp.to === 'string' ? sp.to : undefined;
  const cityId = typeof sp.cityId === 'string' ? sp.cityId : undefined;
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : undefined;
  const phaseId = typeof sp.phaseId === 'string' ? sp.phaseId : undefined;
  const range = localDayRange(from, to);

  const [t, td, tc, tr, to_] = await Promise.all([
    getTranslations({ locale, namespace: 'breakdown' }),
    getTranslations({ locale, namespace: 'dashboard' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'reasons' }),
    getTranslations({ locale, namespace: 'outcome' }),
  ]);

  // Order lines keep a snapshot city NAME rather than a relation, so a city filter has
  // to be translated before it can be applied to them.
  const city = cityId
    ? await prisma.city.findUnique({ where: { id: cityId }, select: { name: true } })
    : null;

  const result = await getBreakdown(metric, {
    from: range.from,
    to: range.to,
    cityId,
    cityName: city?.name,
    projectId,
    phaseId,
  });

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');

  // Back to exactly the dashboard the manager came from.
  const back = new URLSearchParams();
  for (const [key, value] of Object.entries({ from, to, cityId, projectId, phaseId })) {
    if (value) back.set(key, value);
  }
  const backHref = `/manager${back.size ? `?${back}` : ''}`;

  const shown = result.rows.length;
  const empty = shown === 0;

  return (
    <div className="space-y-4">
      <div>
        <Link href={backHref} className="text-xs text-teal-700 hover:text-teal-900">
          {t('backToDashboard')}
        </Link>
        <h1 className="mt-1 text-lg font-bold text-brand-900">{td(metric)}</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {t('count', { shown, total: result.total })}
          {shown < result.total ? ` — ${t('truncated', { shown })}` : ''}
        </p>
      </div>

      <Card>
        {/* Only some figures carry an explanatory line; asking for one that does not
            exist throws rather than returning empty. */}
        <CardHeader
          title={t('title')}
          description={td.has(`${metric}Help`) ? td(`${metric}Help`) : undefined}
        />

        {empty ? (
          <div className="p-4">
            <EmptyState>
              {metric === 'remaining' ? t('emptyRemaining') : t('empty')}
            </EmptyState>
          </div>
        ) : result.kind === 'orderLines' ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{tc('uid')}</Th>
                  <Th>{tc('store')}</Th>
                  <Th>{tc('city')}</Th>
                  <Th>{t('order')}</Th>
                  <Th>{tc('project')}</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((line) => (
                  <tr key={line.id}>
                    <Td className="dir-ltr font-semibold">{line.uid}</Td>
                    <Td>
                      {line.storeName ?? '—'}
                      {line.address ? (
                        <div className="text-xs text-[var(--muted)]">{line.address}</div>
                      ) : null}
                    </Td>
                    <Td>{line.cityName ?? '—'}</Td>
                    <Td className="text-xs">{line.batchLabel}</Td>
                    <Td className="text-xs">
                      {line.projectName ?? '—'}
                      {line.phaseName ? (
                        <div className="text-[var(--muted)]">{line.phaseName}</div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{tc('uid')}</Th>
                  <Th>{t('stand')}</Th>
                  <Th>{tc('store')}</Th>
                  <Th>{tc('city')}</Th>
                  <Th>{tc('date')}</Th>
                  <Th>{tc('technician')}</Th>
                  <Th>{tc('status')}</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((form) => (
                  <tr key={form.id}>
                    <Td className="dir-ltr font-semibold">{form.uid}</Td>
                    <Td className="tabular-nums">{num(form.standIndex)}</Td>
                    <Td>{form.storeName ?? '—'}</Td>
                    <Td>{form.cityName ?? '—'}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDateForLocale(form.date, locale)}
                    </Td>
                    <Td>{form.technicianName ?? '—'}</Td>
                    <Td>
                      {form.outcome === 'REPAIRED' ? (
                        <Badge tone={form.isReRepair ? 'warning' : 'success'}>
                          {to_('REPAIRED')}
                        </Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge tone="danger">{to_('NOT_REPAIRED')}</Badge>
                          {form.notRepairedReason ? (
                            <div className="text-xs text-[var(--muted)]">
                              {tr(form.notRepairedReason)}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
