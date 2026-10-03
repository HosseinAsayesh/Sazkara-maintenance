import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Jti's panel.
 *
 * Read-only by construction rather than by hidden buttons: there is no action on this
 * surface that writes anything except raising a query and requesting a download, and
 * both of those are requests rather than changes. proxy.ts keeps everyone else out;
 * requireClientViewer lets a manager in so they can see exactly what the client sees.
 *
 * The nav is short on purpose. A client given fifteen tabs reads none of them.
 */
export default async function ClientLayout({
  children,
  params,
}: LayoutProps<'/[locale]/client'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireClientViewer(locale);
  const t = await getTranslations({ locale, namespace: 'client' });
  const isManager = user.role === 'MANAGER';
  // Reports waiting for Jti's signature — the one thing on this panel that asks for action.
  const awaitingApproval = await prisma.weeklyReport.count({
    where: { status: 'AWAITING_APPROVAL' },
  });

  return (
    <AppShell
      locale={locale}
      userName={user.name}
      userSubtitle={isManager ? t('managerViewingLabel') : t('roleLabel')}
      nav={[
        { href: '/client', label: t('navReportCard') },
        { href: '/client/today', label: t('navToday') },
        { href: '/client/reports', label: t('navReports') },
        { href: '/client/parts', label: t('navParts') },
        { href: '/client/re-repairs', label: t('navReRepairs') },
        { href: '/client/queries', label: t('queriesTitle') },
        { href: '/client/weekly-reports', label: t('navWeekly'), badge: awaitingApproval },
        { href: '/client/downloads', label: t('navDownloads') },
        // A manager who followed the Jti View tab must not be stranded on a surface with
        // no dashboard, no exports and no settings.
        ...(isManager ? [{ href: '/manager', label: t('backToManager') }] : []),
      ]}
    >
      {/* Stated plainly, because a manager mistaking this for their own dashboard would
          read "no wages" as "the wages are missing". */}
      {isManager ? (
        <div className="mb-4">
          <Alert tone="info" title={t('managerBannerTitle')}>
            {t('managerBannerBody')}
          </Alert>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
