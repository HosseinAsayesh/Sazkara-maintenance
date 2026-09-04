'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { loginAction, type AuthState } from '@/app/actions/auth';

import { Alert, Button, Field, Input } from './ui';

export function LoginForm({ locale, next }: { locale: string; next: string }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />

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

      <Field label={t('password')} required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? tc('loading') : t('login')}
      </Button>

      <p className="text-center text-xs text-[var(--muted)]">
        {t('noAccount')}{' '}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          {t('register')}
        </Link>
      </p>
    </form>
  );
}
