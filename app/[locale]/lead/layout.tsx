import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppShell } from '@/components/AppShell';
import { requireLead } from '@/lib/auth';

/**
 * The crew-lead surface.
 *
 * A lead is not a junior manager: the navigation carries their crew and its work, and
 * nothing else. No parts catalogue, no wage settings, no Jti exports, no imports, no
 * analytics — those stay with the repair manager.
 */
export default async function LeadLayout({
  children,
  params,
}: LayoutProps<'/[locale]/lead'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireLead(locale);
  const t = await getTranslations({ locale, namespace: 'nav' });

  return (
    <AppShell
      locale={locale}
      userName={user.name}
      userSubtitle={user.technicianCode ?? undefined}
      nav={[{ href: '/lead', label: t('crew') }]}
    >
      {children}
    </AppShell>
  );
}
