'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import { generateEvidenceAction, type EvidenceState } from '@/app/actions/evidence';

import { JalaliDateInput } from './JalaliDateInput';
import { Alert, Button, Card, CardHeader, Field, Select } from './ui';

export function EvidenceGenerator({
  locale,
  cities,
}: {
  locale: string;
  cities: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('evidence');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<EvidenceState, FormData>(
    generateEvidenceAction,
    {},
  );
  const [force, setForce] = useState(false);
  // Held in state and submitted through a hidden field: the server action still receives
  // a plain ISO day, the manager still picks it on a Shamsi calendar.
  const [date, setDate] = useState('');

  return (
    <Card>
      <CardHeader title={t('title')} description={t('help')} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="force" value={force ? 'true' : 'false'} />

        <input type="hidden" name="date" value={date} />
        <Field label={t('selectDate')} required>
          <JalaliDateInput value={date} onChange={setDate} ariaLabel={t('selectDate')} />
        </Field>

        <Field label={t('selectCity')} required>
          <Select name="cityId" required defaultValue="">
            <option value="" disabled>
              —
            </option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit" disabled={pending || !date}>
            {pending ? tc('loading') : force ? t('regenerate') : t('generate')}
          </Button>
        </div>

        <div className="sm:col-span-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            {t('regenerate')}
          </label>
        </div>

        {state.error ? (
          <div className="sm:col-span-3">
            <Alert tone="danger">
              {t.has(state.error) ? t(state.error) : tc('error')}
            </Alert>
          </div>
        ) : null}

        {state.ok ? (
          <div className="sm:col-span-3">
            <Alert tone="success" title={t('standsVisited', { count: state.ok.standCount })}>
              <a
                href={state.ok.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline"
              >
                {tc('download')}
              </a>
            </Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
