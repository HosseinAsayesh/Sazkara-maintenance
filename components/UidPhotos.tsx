'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

import { UidAutocomplete } from './UidAutocomplete';
import { Badge, Button, Card, CardHeader, EmptyState } from './ui';

/** The uid box on the photo pages: pick or type a uid, and its photos load below. */
export function UidPhotoSearch({ initial }: { initial: string }) {
  const t = useTranslations('uidLookup');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);

  const go = (uid: string) => {
    const q = uid.trim();
    router.push(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
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
            autoFocus={!initial}
            enterKeyHint="search"
          />
        </div>
        <Button type="submit">{tc('search')}</Button>
      </form>
    </Card>
  );
}

export interface PhotoVisitView {
  id: string;
  formCode: string;
  dateLabel: string;
  standIndex: number;
  outcome: 'REPAIRED' | 'NOT_REPAIRED';
  isReRepair: boolean;
  technicianName: string;
  projectName: string | null;
  photos: Array<{ id: string; type: string; fileRef: string }>;
}

function fileUrl(ref: string) {
  return `/api/files/${ref.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Every visit's photos for one uid, newest first. Tapping a photo opens it full screen;
 * arrows (or swiping through with the buttons) move within that visit.
 */
export function UidPhotoGallery({
  visits,
  title,
  description,
}: {
  visits: PhotoVisitView[];
  title: React.ReactNode;
  description?: string;
}) {
  const t = useTranslations('uidLookup');
  const [open, setOpen] = useState<{ visit: number; photo: number } | null>(null);

  const label = (type: string) =>
    ({
      STORE: t('photoStore'),
      BEFORE: t('photoBefore'),
      AFTER: t('photoAfter'),
      STAMP: t('photoStamp'),
      OTHER: t('photoOther'),
    })[type] ?? type;

  const current = open ? visits[open.visit] : null;
  const photo = current && open ? current.photos[open.photo] : null;

  const step = (delta: number) =>
    setOpen((o) => {
      if (!o) return o;
      const count = visits[o.visit].photos.length;
      return { ...o, photo: (o.photo + delta + count) % count };
    });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      // RTL: the left arrow moves forward.
      if (e.key === 'ArrowLeft') step(1);
      if (e.key === 'ArrowRight') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-5 p-4">
        {visits.length === 0 ? <EmptyState>{t('noPhotos')}</EmptyState> : null}
        {visits.map((v, vi) => (
          <section key={v.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-brand-900">{v.dateLabel}</span>
              <Badge tone={v.outcome === 'REPAIRED' ? 'success' : 'danger'}>
                {v.outcome === 'REPAIRED' ? t('repaired') : t('notRepaired')}
              </Badge>
              {v.standIndex > 1 ? (
                <Badge tone="neutral">{t('stand', { n: v.standIndex })}</Badge>
              ) : null}
              {v.isReRepair ? <Badge tone="warning">{t('reRepair')}</Badge> : null}
              <span className="text-xs text-[var(--muted)]">
                {[v.technicianName, v.projectName, v.formCode].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {v.photos.map((p, pi) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpen({ visit: vi, photo: pi })}
                  className="group overflow-hidden rounded-lg border border-[var(--border)] bg-slate-50 text-start"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fileUrl(p.fileRef)}
                    alt={label(p.type)}
                    loading="lazy"
                    className="aspect-square w-full object-cover transition group-hover:opacity-90"
                  />
                  <span
                    className={
                      'block truncate px-1.5 py-1 text-[0.6875rem] ' +
                      (p.type === 'STAMP' ? 'font-semibold text-brand-700' : 'text-[var(--muted)]')
                    }
                  >
                    {label(p.type)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {open && current && photo ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div className="flex items-center justify-between gap-2 p-3 text-sm text-white">
            <span>
              {label(photo.type)} · {current.dateLabel} ({open.photo + 1}/{current.photos.length})
            </span>
            <button
              type="button"
              className="rounded-lg bg-white/15 px-3 py-1.5"
              onClick={() => setOpen(null)}
            >
              {t('close')}
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(photo.fileRef)}
              alt={label(photo.type)}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {current.photos.length > 1 ? (
            <div className="flex justify-center gap-3 p-3" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="rounded-lg bg-white/15 px-4 py-2 text-white"
                onClick={() => step(-1)}
              >
                {t('prev')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-white/15 px-4 py-2 text-white"
                onClick={() => step(1)}
              >
                {t('next')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
