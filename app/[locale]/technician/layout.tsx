import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppShell } from '@/components/AppShell';
import { requireTechnician } from '@/lib/auth';

export default async function TechnicianLayout({
  children,
  params,
}: LayoutProps<'/[locale]/technician'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireTechnician(locale);
  const t = await getTranslations({ locale, namespace: 'nav' });

  return (
    <AppShell
      locale={locale}
      userName={user.name}
      userSubtitle={user.technicianCode ?? undefined}
      nav={[
        { href: '/technician', label: t('newReport') },
        { href: '/technician/profile', label: t('myProfile') },
      ]}
    >
      {children}
    </AppShell>
  );
}
