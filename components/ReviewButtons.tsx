'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { reviewStandAction, reviewTechnicianAction, type ActionState } from '@/app/actions/manager';

import { Button } from './ui';

/** §7 — approve / reject a technician sign-up. */
export function ReviewTechnicianButtons({
  locale,
  userId,
  status,
}: {
  locale: string;
  userId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}) {
  const t = useTranslations('common');
  const [, action, pending] = useActionState<ActionState, FormData>(
    reviewTechnicianAction,
    {},
  );

  return (
    <form action={action} className="flex gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="locale" value={locale} />

      {status !== 'APPROVED' ? (
        <Button
          type="submit"
          name="decision"
          value="APPROVE"
          size="sm"
          variant="success"
          disabled={pending}
        >
          {t('approve')}
        </Button>
      ) : null}

      {status !== 'REJECTED' ? (
        <Button
          type="submit"
          name="decision"
          value="REJECT"
          size="sm"
          variant="secondary"
          disabled={pending}
        >
          {t('reject')}
        </Button>
      ) : null}
    </form>
  );
}

/** §6.2 — admit a stray uid into the official record, or reject it. */
export function ReviewStandButtons({
  locale,
  standId,
}: {
  locale: string;
  standId: string;
}) {
  const t = useTranslations('common');
  const [, action, pending] = useActionState<ActionState, FormData>(reviewStandAction, {});

  return (
    <form action={action} className="flex gap-2">
      <input type="hidden" name="standId" value={standId} />
      <input type="hidden" name="locale" value={locale} />
      <Button
        type="submit"
        name="decision"
        value="CONFIRM"
        size="sm"
        variant="success"
        disabled={pending}
      >
        {t('confirm')}
      </Button>
      <Button
        type="submit"
        name="decision"
        value="REJECT"
        size="sm"
        variant="secondary"
        disabled={pending}
      >
        {t('reject')}
      </Button>
    </form>
  );
}
