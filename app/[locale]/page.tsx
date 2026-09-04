import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';

/** Entry point: send everyone to the surface their role belongs on. */
export default async function IndexPage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  redirect(`/${locale}/${user.role === 'MANAGER' ? 'manager' : 'technician'}`);
}
