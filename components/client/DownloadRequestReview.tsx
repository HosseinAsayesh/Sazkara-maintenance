'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import {
  decideDownloadAction,
  type DownloadActionState,
} from '@/app/actions/client-downloads';

import { Alert, Button, Input } from '../ui';

/**
 * The manager's approve / deny on one request.
 *
 * Approving builds the file there and then, which can take a moment for a workbook of a
 * thousand rows and longer for an evidence PDF (it drives a real Chrome). The button
 * disables while that happens rather than pretending it was instant.
 *
 * A failed build leaves the request PENDING: a decision the manager made must not be
 * consumed by an error they had nothing to do with.
 */
export function DownloadRequestReview({
  locale,
  requestId,
}: {
  locale: string;
  requestId: string;
}) {
  const t = useTranslations('client');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<DownloadActionState, FormData>(
    decideDownloadAction,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="locale" value={locale} />
      <Input
        name="note"
        placeholder={t('decisionNotePlaceholder')}
        className="min-w-[12rem] flex-1"
      />
      <Button
        type="submit"
        name="decision"
        value="APPROVE"
        size="sm"
        variant="success"
        disabled={pending}
      >
        {pending ? tc('saving') : tc('approve')}
      </Button>
      <Button
        type="submit"
        name="decision"
        value="DENY"
        size="sm"
        variant="secondary"
        disabled={pending}
      >
        {tc('reject')}
      </Button>
      {state.error ? (
        <div className="w-full">
          <Alert tone="danger">{t(`requestError.${state.error}`)}</Alert>
        </div>
      ) : null}
    </form>
  );
}
