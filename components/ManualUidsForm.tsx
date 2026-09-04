'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { addManualUidsAction, type CommitState } from '@/app/actions/imports';

import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from './ui';

/**
 * §5 — Jti sometimes sends a handful of stray uids as plain text rather than in the
 * spreadsheet. These enter through the same pending-confirmation gate as a technician's
 * unknown uid (§6.2) rather than straight into the official record.
 */
export function ManualUidsForm({
  locale,
  cities,
}: {
  locale: string;
  cities: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('imports');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<CommitState, FormData>(
    addManualUidsAction,
    {},
  );

  return (
    <Card>
      <CardHeader title={t('manualUid')} description={t('manualUidHelp')} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="locale" value={locale} />

        <Field label={t('batchName')}>
          <Input name="name" placeholder={t('batchNamePlaceholder')} />
        </Field>

        <Field label={tc('city')}>
          <Select name="cityName" defaultValue="">
            <option value="">—</option>
            {cities.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <Field label={tc('uid')} required>
            <Textarea name="uids" placeholder={t('manualUidPlaceholder')} dir="ltr" required />
          </Field>
        </div>

        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? tc('submitting') : tc('save')}
          </Button>
          {state.ok ? (
            <span className="text-sm text-emerald-700">
              {t('committed', { count: state.ok.created })}
            </span>
          ) : null}
        </div>

        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="danger">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : tc('error')}
            </Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
