import { setRequestLocale } from 'next-intl/server';

import { UidPhotoPage } from '@/components/UidPhotoPage';
import { requireLead } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** The crew lead's photo lookup, same as the technician's. */
export default async function LeadPhotosPage({
  params,
  searchParams,
}: PageProps<'/[locale]/lead/photos'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireLead(locale);
  const sp = await searchParams;
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';
  return <UidPhotoPage locale={locale} query={query} />;
}
