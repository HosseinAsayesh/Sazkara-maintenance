'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import { changeOwnPasswordAction } from '@/app/actions/account';
import type { ActionState } from '@/app/actions/manager';

import { Alert, Button, Card, CardHeader, Field, Input } from './ui';

/** The manager's own password: current one, then the new one twice. */
export function ChangePasswordCard() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    changeOwnPasswordAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the boxes once it has worked, so no password lingers on screen.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <Card id="my-password">
      <CardHeader title={t('title')} description={t('help')} />
      <form ref={formRef} action={action} className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label={t('current')} required>
          <Input name="currentPassword" type="password" autoComplete="current-password" dir="ltr" required />
        </Field>
        <Field label={t('new')} hint={t('newHint')} required>
          <Input name="newPassword" type="password" autoComplete="new-password" dir="ltr" required />
        </Field>
        <Field label={t('repeat')} required>
          <Input name="repeatPassword" type="password" autoComplete="new-password" dir="ltr" required />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={pending}>
            {pending ? tc('saving') : t('submit')}
          </Button>
        </div>
        {state.error ? (
          <div className="sm:col-span-3">
            <Alert tone="danger">{t(`errors.${state.error}`)}</Alert>
          </div>
        ) : null}
        {state.ok ? (
          <div className="sm:col-span-3">
            <Alert tone="success">{t('changed')}</Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
