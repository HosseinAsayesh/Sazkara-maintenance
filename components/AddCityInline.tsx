'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import { addCityAction, type ActionState } from '@/app/actions/manager';

import { Button, Input } from './ui';

/**
 * Add a city without leaving the dashboard.
 *
 * Cities appear mid-campaign — Jti sends a batch for a town that isn't on file yet — and
 * making the manager detour into Settings to unblock a filter is friction at exactly the
 * wrong moment. Collapsed by default so it stays out of the way.
 *
 * `isTehran` is a pricing flag rather than a name test (§6.6): any city marked here is
 * paid at the Tehran rate and reported on the Tehran side of the split.
 */
export function AddCityInline({ locale }: { locale: string }) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addCityAction,
    {},
  );

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        + {t('addCity')}
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="locale" value={locale} />
      <div className="min-w-[10rem]">
        <span className="mb-1 block text-xs font-medium text-ink-500">
          {t('cityName')}
        </span>
        <Input name="cityName" required aria-label={t('cityName')} />
      </div>
      <label className="flex items-center gap-2 pb-2 text-xs">
        <input type="checkbox" name="isTehran" />
        {t('isTehran')}
      </label>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? tc('saving') : tc('add')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        {tc('cancel')}
      </Button>
      {state.ok ? (
        <span className="pb-2 text-xs text-teal-700">{t('cityAdded')}</span>
      ) : null}
    </form>
  );
}
