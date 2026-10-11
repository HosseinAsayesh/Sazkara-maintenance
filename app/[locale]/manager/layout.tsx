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
  const [pendingTechnicians, pendingResets, pendingStands, pendingDownloads, openQueries] =
    await Promise.all([
    prisma.user.count({ where: { role: 'TECHNICIAN', status: 'PENDING' } }),
    // A technician locked out of the app cannot work, so a reset request waits here too.
    prisma.passwordResetRequest.count({ where: { status: 'PENDING' } }),
    prisma.store.count({ where: { confirmation: 'PENDING' } }),
    // Jti waiting on a file is a blocked conversation, so it earns a badge like the
    // other two things that stop work.
    prisma.downloadRequest.count({ where: { status: 'PENDING' } }),
    // OPEN only, not "everything unresolved". An ANSWERED thread is waiting on Jti, not
    // on us, and a badge that keeps counting after the manager has replied is one they
    // learn to ignore.
    prisma.formQuery.count({ where: { status: 'OPEN' } }),
  ]);

  return (
    <AppShell
      locale={locale}
      userName={user.name}
      userSubtitle={user.phone}
      isManager
      notifications
      nav={[
        { href: '/manager', label: t('dashboard') },
        { href: '/manager/projects', label: t('projects') },
        { href: '/manager/imports', label: t('imports') },
        { href: '/manager/pending-uids', label: t('pendingUids'), badge: pendingStands },
        {
          href: '/manager/technicians',
          label: t('technicians'),
          badge: pendingTechnicians + pendingResets,
        },
        { href: '/manager/exports', label: t('exports') },
        { href: '/manager/weekly-reports', label: t('weeklyReports') },
        { href: '/manager/evidence', label: t('evidence') },
        { href: '/manager/analytics', label: t('analytics') },
        { href: '/manager/re-repairs', label: t('reRepairs') },
        // Archive and single-uid search are one tab: the search opens a uid's full
        // history at /manager/uid, which stays lit under the same tab.
        { href: '/manager/uids', label: t('uidArchive'), alsoMatches: ['/manager/uid'] },
        { href: '/manager/historical', label: t('historical') },
        { href: '/manager/parts', label: t('parts') },
        { href: '/manager/settings', label: t('settings') },
        // Opens Jti's own panel, which carries its own nav and a way back. Deliberately
        // the client's surface rather than a manager copy of it: the manager needs to
        // see what the client sees, redactions included, not a better version.
        { href: '/manager/queries', label: t('queries'), badge: openQueries },
        { href: '/manager/download-requests', label: t('downloadRequests'), badge: pendingDownloads },
        { href: '/client', label: t('clientView') },
      ]}
    >
      {children}
    </AppShell>
  );
}
