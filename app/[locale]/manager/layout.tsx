import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppShell } from '@/components/AppShell';
import { requireManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function ManagerLayout({
  children,
  params,
}: LayoutProps<'/[locale]/manager'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireManager(locale);
  const t = await getTranslations({ locale, namespace: 'nav' });

  // Badge counts for the two things that block the manager's workflow.
  const [pendingTechnicians, pendingStands] = await Promise.all([
    prisma.user.count({ where: { role: 'TECHNICIAN', status: 'PENDING' } }),
    prisma.store.count({ where: { confirmation: 'PENDING' } }),
  ]);

  return (
    <AppShell
      locale={locale}
      userName={user.name}
      userSubtitle={user.phone}
      nav={[
        { href: '/manager', label: t('dashboard') },
        { href: '/manager/projects', label: t('projects') },
        { href: '/manager/imports', label: t('imports') },
        { href: '/manager/pending-uids', label: t('pendingUids'), badge: pendingStands },
        {
          href: '/manager/technicians',
          label: t('technicians'),
          badge: pendingTechnicians,
        },
        { href: '/manager/exports', label: t('exports') },
        { href: '/manager/evidence', label: t('evidence') },
        { href: '/manager/analytics', label: t('analytics') },
        { href: '/manager/re-repairs', label: t('reRepairs') },
        { href: '/manager/uids', label: t('uidArchive') },
        { href: '/manager/uid', label: t('uidSearch') },
        { href: '/manager/historical', label: t('historical') },
        { href: '/manager/parts', label: t('parts') },
        { href: '/manager/settings', label: t('settings') },
      ]}
    >
      {children}
    </AppShell>
  );
}
