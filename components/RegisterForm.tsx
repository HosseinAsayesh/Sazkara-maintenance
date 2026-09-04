'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { registerAction, type AuthState } from '@/app/actions/auth';

import { Alert, Button, Field, Input } from './ui';

export function RegisterForm({ locale }: { locale: string }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<AuthState, FormData>(registerAction, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {state.error ? (
        <Alert tone="danger">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : state.error}
        </Alert>
      ) : null}

      <Field label={t('name')} required>
        <Input name="name" autoComplete="name" required />
      </Field>

      <Field label={t('phone')} required>
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          className="dir-ltr"
          autoComplete="username"
          placeholder="09121234567"
          required
        />
      </Field>

      <Field label={t('password')} required>
        <Input name="password" type="password" autoComplete="new-password" minLength={6} required />
      </Field>

      <Field label={t('passwordConfirm')} required>
        <Input name="passwordConfirm" type="password" autoComplete="new-password" required />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? tc('loading') : t('register')}
      </Button>

      <p className="text-center text-xs text-[var(--muted)]">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          {t('login')}
        </Link>
      </p>
    </form>
  );
}
