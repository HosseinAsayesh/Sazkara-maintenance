'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { requestPasswordResetAction } from '@/app/actions/password-reset';
import type { ActionState } from '@/app/actions/manager';
import { Link } from '@/i18n/navigation';

import { Alert, Button, Field, Input } from './ui';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    requestPasswordResetAction,
    {},
  );

  return (
    <div className="space-y-4">
      {state.ok ? (
        <Alert tone="success" title={t('forgotSentTitle')}>
          {t('forgotSent')}
        </Alert>
      ) : (
        <form action={action} className="space-y-4">
          {state.error ? (
            <Alert tone="danger">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
            </Alert>
          ) : null}

          <Field label={t('phone')} required>
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              dir="ltr"
              className="dir-ltr"
              placeholder="09121234567"
              required
            />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? tc('loading') : t('forgotSubmit')}
          </Button>
        </form>
      )}

      <p className="text-center text-xs text-[var(--muted)]">
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
