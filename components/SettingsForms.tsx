'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import {
  addCityAction,
  saveSettingsAction,
  toggleCityTehranAction,
  type ActionState,
} from '@/app/actions/manager';

import { Alert, Button, Card, CardHeader, Field, Input } from './ui';

/** §6.6 — every rate the wage calculation uses is edited here, never in code. */
export function WageSettingsForm({
  locale,
  wages,
  app,
}: {
  locale: string;
  wages: Record<string, number>;
  app: { companyName: string; managerContactEmail: string };
}) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveSettingsAction,
    {},
  );

  const RATE_KEYS = [
    'tehranStandRate',
    'otherCityStandRate',
    'secondStandRate',
    'thirdPlusStandRate',
  ] as const;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      <Card>
        <CardHeader title={t('wagesTitle')} description={t('wagesHelp')} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {RATE_KEYS.map((key) => (
            <Field key={key} label={t(key)} hint={tc('toman')}>
              <Input
                name={key}
                type="number"
                min={0}
                step={1000}
                defaultValue={wages[key] ?? 0}
                className="dir-ltr"
                inputMode="numeric"
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={t('appTitle')} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label={t('companyName')}>
            <Input name="companyName" defaultValue={app.companyName} />
          </Field>
          <Field
            label={t('managerContactEmail')}
            hint={t('managerContactEmailHelp')}
          >
            <Input
              name="managerContactEmail"
              type="email"
              dir="ltr"
              className="dir-ltr"
              defaultValue={app.managerContactEmail}
            />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : tc('save')}
        </Button>
        {state.ok ? <span className="text-sm text-emerald-700">{t('saved')}</span> : null}
        {state.error ? <Alert tone="danger">{tc('error')}</Alert> : null}
      </div>
    </form>
  );
}

export function CitySettings({
  locale,
  cities,
}: {
  locale: string;
  cities: Array<{ id: string; name: string; isTehran: boolean }>;
}) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<ActionState, FormData>(addCityAction, {});

  return (
    <Card>
      <CardHeader title={t('citiesTitle')} description={t('citiesHelp')} />

      <ul className="divide-y divide-[var(--border)]">
        {cities.map((city) => (
          <li key={city.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium">{city.name}</span>
            {/* Tehran is a pricing bucket, not a name — the flag is what the split reads. */}
            <form action={toggleCityTehranAction}>
              <input type="hidden" name="cityId" value={city.id} />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="isTehran" value={city.isTehran ? 'false' : 'true'} />
              <button
                type="submit"
                className={
                  city.isTehran
                    ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-full border border-[var(--border)] px-3 py-1 text-xs text-slate-600 hover:bg-brand-50'
                }
              >
                {t('isTehran')}
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={action} className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] p-4">
        <input type="hidden" name="locale" value={locale} />
        <div className="min-w-[12rem] flex-1">
          <Field label={t('cityName')} required>
            <Input name="cityName" required />
          </Field>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="isTehran" />
          {t('isTehran')}
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('addCity')}
        </Button>
        {state.ok ? <span className="pb-2 text-sm text-emerald-700">{t('saved')}</span> : null}
      </form>
    </Card>
  );
}
