'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

import { Button, Card, Input } from './ui';

export function UidSearchBox({ initial }: { initial: string }) {
  const t = useTranslations('uidSearch');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);

  return (
    <Card className="p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          router.push(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
        }}
        className="flex gap-2"
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('placeholder')}
          dir="ltr"
          className="dir-ltr"
          autoFocus
        />
        <Button type="submit">{tc('search')}</Button>
      </form>
    </Card>
  );
}
