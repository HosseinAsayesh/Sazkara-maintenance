'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';

import { UidAutocomplete } from './UidAutocomplete';
import { Button } from './ui';

/**
 * §4.2 — the technician's landing screen. Deliberately one large field and one large
 * button: this is used one-handed, outdoors, on a phone. Matching uids are listed as
 * they are typed, so most visits start with a tap rather than the whole code.
 */
export function UidEntryForm({ target = '/technician/stand' }: { target?: string }) {
  const t = useTranslations('technician');
  const router = useRouter();
  const [uid, setUid] = useState('');
  const [pending, setPending] = useState(false);

  const go = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setPending(true);
    // next-intl's router prepends the active locale; only the path after it is ours.
    router.push(`${target}/${encodeURIComponent(trimmed)}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(uid);
      }}
      className="space-y-3"
    >
      <UidAutocomplete
        value={uid}
        onChange={setUid}
        onPick={go}
        placeholder={t('uidPlaceholder')}
        className="dir-ltr h-14 text-center text-xl font-semibold tracking-wide"
        autoFocus
        enterKeyHint="go"
      />
      <Button type="submit" size="lg" className="w-full" disabled={!uid.trim() || pending}>
        {t('continue')}
      </Button>
    </form>
  );
}
