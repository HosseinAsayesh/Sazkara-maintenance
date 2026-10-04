import { getTranslations } from 'next-intl/server';

import { formatDateForLocale } from '@/lib/dates';
import { loadUidPhotos } from '@/lib/uid-lookup';

import { UidPhotoGallery, UidPhotoSearch, type PhotoVisitView } from './UidPhotos';
import { Alert } from './ui';

/**
 * «عکس‌های شناسه»: pick a uid, see every photo taken there. Shared by the technician and
 * the crew lead; kept off the report page so that page stays clean.
 */
export async function UidPhotoPage({ locale, query }: { locale: string; query: string }) {
  const t = await getTranslations({ locale, namespace: 'uidLookup' });
  const result = query ? await loadUidPhotos(query) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('help')}</p>
      </div>
      <UidPhotoSearch initial={query} />
      {query && !result ? <Alert tone="warning">{t('unknownUid')}</Alert> : null}
      {result ? (
        <UidPhotoGallery
          title={<span className="dir-ltr">{result.uid}</span>}
          description={[
            result.storeName,
            result.cityName,
            t('visitCount', { count: result.visitCount }),
          ]
            .filter(Boolean)
            .join(' · ')}
          visits={result.visits.map((v) => toView(v, locale))}
        />
      ) : null}
    </div>
  );
}

export function toView(
  v: NonNullable<Awaited<ReturnType<typeof loadUidPhotos>>>['visits'][number],
  locale: string,
): PhotoVisitView {
  return {
    id: v.id,
    formCode: v.formCode,
    dateLabel: formatDateForLocale(v.date, locale),
    standIndex: v.standIndex,
    outcome: v.outcome,
    isReRepair: v.isReRepair,
    technicianName: v.technicianName,
    projectName: v.projectName,
    photos: v.photos,
  };
}
