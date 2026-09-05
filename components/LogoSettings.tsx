'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { uploadLogoAction, type ActionState } from '@/app/actions/manager';

import { Alert, Button, Card, CardHeader } from './ui';

/**
 * The evidence-PDF cover logo (§9).
 *
 * Uploaded rather than committed to the repository: the logo is the client's asset, it
 * changes without a deploy, and it does not belong in source control.
 */
export function LogoSettings({
  locale,
  logoUrl,
}: {
  locale: string;
  logoUrl: string | null;
}) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const tErr = useTranslations('errors');

  const [state, action, pending] = useActionState<ActionState, FormData>(
    uploadLogoAction,
    {},
  );

  return (
    <Card>
      <CardHeader title={t('logoTitle')} description={t('logoHelp')} />
      <form action={action} className="flex flex-wrap items-end gap-4 p-4">
        <input type="hidden" name="locale" value={locale} />

        <div className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-ink-500">
            {t('logoCurrent')}
          </span>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={t('logoTitle')}
              className="h-16 w-auto rounded border border-[var(--border)] bg-white p-1"
            />
          ) : (
            <span className="text-xs text-[var(--muted)]">{t('logoNone')}</span>
          )}
        </div>

        <div className="min-w-[14rem] flex-1">
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            required
            className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
          />
        </div>

        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? tc('saving') : t('logoUpload')}
        </Button>

        {state.ok ? (
          <span className="pb-2 text-sm text-teal-700">{t('saved')}</span>
        ) : null}
        {state.error ? (
          <div className="w-full">
            <Alert tone="danger">
              {tErr.has(state.error) ? tErr(state.error) : tc('error')}
            </Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
