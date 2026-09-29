'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { installLicenseAction } from '@/app/actions/license';
import type { ActionState } from '@/app/actions/manager';

import { Alert, Badge, Button, Card, CardHeader, Field, Textarea } from './ui';

const STATUS_TONE = {
  valid: 'success',
  expiring: 'warning',
  expired: 'danger',
  missing: 'danger',
  invalid: 'danger',
} as const;

/**
 * Shows the license and takes a new one. The license is pasted rather than uploaded as a
 * file because it usually arrives as a messenger text, and a paste survives that.
 */
export function LicenseSettings({
  locale,
  status,
  licensee,
  expiresLabel,
  daysLeft,
}: {
  locale: string;
  status: keyof typeof STATUS_TONE;
  licensee: string | null;
  /** Pre-formatted on the server, in the viewer's calendar. */
  expiresLabel: string | null;
  daysLeft: number | null;
}) {
  const t = useTranslations('license');
  const tc = useTranslations('common');

  const [state, action, pending] = useActionState<ActionState, FormData>(
    installLicenseAction,
    {},
  );

  return (
    <Card id="license">
      <CardHeader
        title={t('title')}
        description={t('help')}
        action={<Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>}
      />

      <div className="space-y-4 p-4">
        {licensee ? (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-[var(--muted)]">{t('licensee')}</dt>
            <dd className="font-medium">{licensee}</dd>
            <dt className="text-[var(--muted)]">{t('expires')}</dt>
            <dd className="font-medium">
              {expiresLabel ?? t('permanent')}
              {daysLeft !== null && status !== 'expired' ? (
                <span className="ms-2 text-[var(--muted)]">
                  ({t('daysLeft', { count: daysLeft })})
                </span>
              ) : null}
            </dd>
          </dl>
        ) : null}

        <form action={action} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <Field label={t('pasteLabel')} hint={t('pasteHint')}>
            <Textarea
              name="license"
              rows={6}
              dir="ltr"
              spellCheck={false}
              className="dir-ltr font-mono text-xs"
              placeholder="-----BEGIN SAZKARA LICENSE-----"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? tc('saving') : t('install')}
            </Button>
          </div>
          {state.error ? <Alert tone="danger">{t(`errors.${state.error}`)}</Alert> : null}
          {state.ok ? <Alert tone="success">{t('installed')}</Alert> : null}
        </form>
      </div>
    </Card>
  );
}
