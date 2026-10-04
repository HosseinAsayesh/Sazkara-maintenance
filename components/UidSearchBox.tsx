'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

import { UidAutocomplete } from './UidAutocomplete';
import { Button, Card } from './ui';

export function UidSearchBox({
  initial,
  target,
  autoFocus = true,
}: {
  initial: string;
  /** Where the search lands. Defaults to the current page. */
  target?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations('uidSearch');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);

  const go = (input: string) => {
    const q = input.trim();
    const base = target ?? pathname;
    router.push(q ? `${base}?q=${encodeURIComponent(q)}` : base);
  };

  return (
    <Card className="p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="flex gap-2"
      >
        <div className="min-w-0 flex-1">
          <UidAutocomplete
            value={value}
            onChange={setValue}
            onPick={go}
            placeholder={t('placeholder')}
            className="dir-ltr"
            autoFocus={autoFocus}
            enterKeyHint="search"
          />
        </div>
        <Button type="submit">{tc('search')}</Button>
      </form>
    </Card>
  );
}
