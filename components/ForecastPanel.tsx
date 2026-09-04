'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { forecastAction, type ForecastState } from '@/app/actions/analytics';

import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Table,
  TableWrap,
  Td,
  Th,
} from './ui';

export function ForecastPanel({
  locale,
  from,
  to,
  cityId,
}: {
  locale: string;
  from?: string;
  to?: string;
  cityId?: string;
}) {
  const t = useTranslations('analytics');
  const tc = useTranslations('common');
  const activeLocale = useLocale();
  const [state, action, pending] = useActionState<ForecastState, FormData>(forecastAction, {});

  return (
    <Card>
      <CardHeader title={t('forecastTitle')} description={t('forecastHelp')} />
      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="from" value={from ?? ''} />
        <input type="hidden" name="to" value={to ?? ''} />
        <input type="hidden" name="cityId" value={cityId ?? ''} />

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Field label={t('forecastStandCount')} required>
              <Input
                name="standCount"
                type="number"
                min={1}
                required
                inputMode="numeric"
                className="dir-ltr"
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? tc('loading') : t('forecastRun')}
          </Button>
        </div>

        {state.error ? <Alert tone="danger">{tc('error')}</Alert> : null}

        {state.result ? (
          state.result.basisStandCount === 0 ? (
            <Alert tone="warning">{tc('noResults')}</Alert>
          ) : (
            <>
              <Alert tone="info">
                {t('basisForms', { count: state.result.basisStandCount })}
              </Alert>
              <TableWrap>
                <Table className="min-w-0">
                  <thead>
                    <tr>
                      <Th>{tc('part')}</Th>
                      <Th>{t('forecastRatePerStand')}</Th>
                      <Th>{t('forecastEstimated')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.rows.map((row) => (
                      <tr key={row.nameEn}>
                        <Td>{activeLocale === 'fa' ? row.nameFa : row.nameEn}</Td>
                        <Td className="tabular-nums">{row.perStandRate.toFixed(3)}</Td>
                        <Td className="tabular-nums font-semibold">{row.estimatedQuantity}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </>
          )
        ) : null}
      </form>
    </Card>
  );
}
