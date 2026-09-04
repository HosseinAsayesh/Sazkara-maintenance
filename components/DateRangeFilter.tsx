'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, Input, Select } from './ui';

/**
 * Date range (+ optional city) filter, kept in the URL so a filtered dashboard is
 * shareable and survives a refresh.
 *
 * The inputs are native `type="date"`, which always speaks Gregorian ISO. The Jalali
 * conversion happens on the server at render/export time — trying to make the browser's
 * date picker Persian would mean shipping a whole custom calendar widget for no gain to
 * the manager, who is picking a reporting window rather than reading a date.
 */
export function DateRangeFilter({
  from,
  to,
  cities,
  cityId,
  extra,
}: {
  from?: string;
  to?: string;
  cities?: Array<{ id: string; name: string }>;
  cityId?: string;
  extra?: React.ReactNode;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [localFrom, setLocalFrom] = useState(from ?? '');
  const [localTo, setLocalTo] = useState(to ?? '');
  const [localCity, setLocalCity] = useState(cityId ?? '');

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of [
      ['from', localFrom],
      ['to', localTo],
      ['cityId', localCity],
    ]) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <Card className="p-3">
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[9rem]">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t('from')}</span>
          <Input
            type="date"
            value={localFrom}
            onChange={(e) => setLocalFrom(e.target.value)}
            className="dir-ltr"
          />
        </label>

        <label className="flex-1 min-w-[9rem]">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t('to')}</span>
          <Input
            type="date"
            value={localTo}
            onChange={(e) => setLocalTo(e.target.value)}
            className="dir-ltr"
          />
        </label>

        {cities ? (
          <label className="flex-1 min-w-[9rem]">
            <span className="mb-1 block text-xs font-medium text-slate-600">{t('city')}</span>
            <Select value={localCity} onChange={(e) => setLocalCity(e.target.value)}>
              <option value="">{t('all')}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <Button type="submit" variant="secondary">
          {t('filter')}
        </Button>
        {extra}
      </form>
    </Card>
  );
}
