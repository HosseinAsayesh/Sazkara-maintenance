'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { saveClientAccountAction, setClientAccessAction } from '@/app/actions/client-account';
import type { ActionState } from '@/app/actions/manager';

import { Alert, Badge, Button, Card, CardHeader, Field, Input } from './ui';

/**
 * The shared JTI supervisor login: create it, rename it, reset its password, or switch it
 * off — all without touching the server.
 */
export function JtiAccountSettings({
  locale,
  account,
}: {
  locale: string;
  account: { name: string; phone: string; status: string } | null;
}) {
  const t = useTranslations('jtiAccount');
  const tc = useTranslations('common');

  const [saveState, save, saving] = useActionState<ActionState, FormData>(
    saveClientAccountAction,
    {},
  );
  const [accessState, setAccess, switching] = useActionState<ActionState, FormData>(
    setClientAccessAction,
    {},
  );

  const active = account?.status === 'APPROVED';

  return (
    <Card id="jti-account">
      <CardHeader
        title={t('title')}
        description={t('help')}
        action={
          <Badge tone={!account ? 'neutral' : active ? 'success' : 'danger'}>
            {!account ? t('statusNone') : active ? t('statusActive') : t('statusDisabled')}
          </Badge>
        }
      />

      <form action={save} className="space-y-4 p-4">
        <input type="hidden" name="locale" value={locale} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('name')} required>
            <Input name="name" defaultValue={account?.name ?? t('defaultName')} />
          </Field>
          <Field label={t('phone')} hint={t('phoneHint')} required>
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="dir-ltr"
              defaultValue={account?.phone ?? ''}
              placeholder="09121234567"
            />
          </Field>
          <Field
            label={account ? t('newPassword') : t('password')}
            hint={account ? t('newPasswordHint') : t('passwordHint')}
            required={!account}
          >
            <Input name="password" type="password" autoComplete="new-password" dir="ltr" />
          </Field>
          <Field label={t('passwordConfirm')} required={!account}>
            <Input name="passwordConfirm" type="password" autoComplete="new-password" dir="ltr" />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? tc('saving') : account ? tc('save') : t('create')}
          </Button>
        </div>
        {saveState.error ? <Alert tone="danger">{t(`errors.${saveState.error}`)}</Alert> : null}
        {saveState.ok ? <Alert tone="success">{t(`ok.${saveState.ok}`)}</Alert> : null}
      </form>

      {account ? (
        <form
          action={setAccess}
          className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] p-4"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="enable" value={active ? '0' : '1'} />
          <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--muted)]">
            {active ? t('disableHelp') : t('enableHelp')}
          </p>
          <Button type="submit" variant={active ? 'danger' : 'success'} disabled={switching}>
            {active ? t('disable') : t('enable')}
          </Button>
          {accessState.ok ? (
            <div className="w-full">
              <Alert tone="success">{t(`ok.${accessState.ok}`)}</Alert>
            </div>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}
