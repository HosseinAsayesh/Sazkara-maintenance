import { setRequestLocale } from 'next-intl/server';

import { UidPhotoPage } from '@/components/UidPhotoPage';
import { requireTechnician } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** The technician's photo lookup: what a stand looked like on earlier visits. */
export default async function TechnicianPhotosPage({
  params,
  searchParams,
}: PageProps<'/[locale]/technician/photos'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTechnician(locale);
  const sp = await searchParams;
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';
  return <UidPhotoPage locale={locale} query={query} />;
}
