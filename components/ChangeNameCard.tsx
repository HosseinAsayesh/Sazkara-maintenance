'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { changeOwnNameAction } from '@/app/actions/account';
import type { ActionState } from '@/app/actions/manager';

import { Alert, Button, Card, CardHeader, Field, Input } from './ui';

/** The manager's own display name — shown in the header, on reports and approvals. */
export function ChangeNameCard({ name }: { name: string }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    changeOwnNameAction,
    {},
  );

  return (
    <Card id="my-name">
      <CardHeader title={t('nameTitle')} description={t('nameHelp')} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label={t('name')} required>
            <Input name="name" defaultValue={name} autoComplete="name" required maxLength={80} />
          </Field>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {pending ? tc('saving') : t('nameSubmit')}
          </Button>
        </div>
        {state.error ? (
          <div className="sm:col-span-3">
            <Alert tone="danger">{t(`errors.${state.error}`)}</Alert>
          </div>
        ) : null}
        {state.ok ? (
          <div className="sm:col-span-3">
            <Alert tone="success">{t('nameChanged')}</Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
