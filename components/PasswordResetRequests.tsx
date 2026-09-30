'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { resolvePasswordResetAction } from '@/app/actions/password-reset';
import type { ActionState } from '@/app/actions/manager';

import { Alert, Badge, Button, Card, CardHeader, Input } from './ui';

export interface ResetRequestRow {
  id: string;
  name: string;
  phone: string;
  code: string | null;
  requestedOn: string;
}

function RequestRow({ locale, row }: { locale: string; row: ResetRequestRow }) {
  const t = useTranslations('technicians');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    resolvePasswordResetAction,
    {},
  );

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="requestId" value={row.id} />

      <div className="min-w-[12rem] flex-1">
        <div className="font-medium">
          {row.name}
          {row.code ? <span className="ms-2 text-xs text-[var(--muted)] dir-ltr">{row.code}</span> : null}
        </div>
        <div className="text-xs text-[var(--muted)]">
          <span className="dir-ltr">{row.phone}</span> · {t('resetRequestedOn', { date: row.requestedOn })}
        </div>
      </div>

      <Input
        name="password"
        type="text"
        autoComplete="off"
        dir="ltr"
        className="dir-ltr w-40"
        placeholder={t('resetNewPassword')}
        aria-label={t('resetNewPassword')}
      />
      <Button type="submit" name="decision" value="SET" size="sm" variant="success" disabled={pending}>
        {t('resetSet')}
      </Button>
      <Button type="submit" name="decision" value="DISMISS" size="sm" variant="secondary" disabled={pending}>
        {t('resetDismiss')}
      </Button>

      {state.error ? (
        <div className="w-full">
          <Alert tone="danger">{t(`resetErrors.${state.error}`)}</Alert>
        </div>
      ) : null}
    </form>
  );
}

/**
 * Technicians who pressed "forgot password". The manager types a temporary password —
 * shown in plain text on purpose, since it is about to be read out to the technician —
 * and tells it to them by phone or in person.
 */
export function PasswordResetRequests({
  locale,
  rows,
}: {
  locale: string;
  rows: ResetRequestRow[];
}) {
  const t = useTranslations('technicians');
  if (rows.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {t('resetTitle')}
            <Badge tone="warning">{rows.length}</Badge>
          </span>
        }
        description={t('resetHelp')}
      />
      <div>
        {rows.map((row) => (
          <RequestRow key={row.id} locale={locale} row={row} />
        ))}
      </div>
    </Card>
  );
}
