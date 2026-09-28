'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { raiseQueryAction, type QueryActionState } from '@/app/actions/client-queries';

import { Alert, Button, Card, CardHeader, Textarea } from '../ui';

/**
 * Jti asks about one visit.
 *
 * Deliberately attached to a form rather than offered as a general "contact us" box. A
 * question about a specific stand, filed against that stand, is answerable and closable;
 * a general message is an email with extra steps.
 */
export function RaiseQueryForm({ locale, formId }: { locale: string; formId: string }) {
  const t = useTranslations('client');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<QueryActionState, FormData>(
    raiseQueryAction,
    {},
  );

  return (
    <Card>
      <CardHeader title={t('queryAskTitle')} description={t('queryAskHelp')} />
      <form action={action} className="space-y-3 p-4">
        <input type="hidden" name="formId" value={formId} />
        <input type="hidden" name="locale" value={locale} />
        <Textarea name="body" rows={3} placeholder={t('queryAskPlaceholder')} />
        {state.error ? <Alert tone="danger">{t(`queryError.${state.error}`)}</Alert> : null}
        {state.ok ? <Alert tone="success">{t('queryRaised')}</Alert> : null}
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : t('queryAskAction')}
        </Button>
      </form>
    </Card>
  );
}
