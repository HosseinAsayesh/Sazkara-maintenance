'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';

import { Button, Input } from './ui';

/**
 * §4.2 — the technician's landing screen. Deliberately one large field and one large
 * button: this is used one-handed, outdoors, on a phone.
 */
export function UidEntryForm() {
  const t = useTranslations('technician');
  const router = useRouter();
  const [uid, setUid] = useState('');
  const [pending, setPending] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = uid.trim();
    if (!trimmed) return;
    setPending(true);
    // next-intl's router prepends the active locale; only the path after it is ours.
    router.push(`/technician/stand/${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input
        value={uid}
        onChange={(e) => setUid(e.target.value)}
        placeholder={t('uidPlaceholder')}
        dir="ltr"
        className="dir-ltr h-14 text-center text-xl font-semibold tracking-wide"
        autoFocus
        autoComplete="off"
        enterKeyHint="go"
      />
      <Button type="submit" size="lg" className="w-full" disabled={!uid.trim() || pending}>
        {t('continue')}
      </Button>
    </form>
  );
}
