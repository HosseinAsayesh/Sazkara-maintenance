import { getTranslations, setRequestLocale } from 'next-intl/server';

import { QueryQueue } from '@/components/client/QueryQueue';
import { Alert } from '@/components/ui';
import { requireManager } from '@/lib/auth';
import { getClientScope, getQueryThreads } from '@/lib/client-view';

/**
 * What Jti is waiting on an answer for.
 *
 * Unresolved threads sort first, which is the whole job of this page: the manager should
 * be able to see in one glance whether anything is outstanding, because a client's
 * unanswered question is the thing that turns into a phone call.
 */
export default async function ManagerQueriesPage({
  params,
}: PageProps<'/[locale]/manager/queries'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const threads = await getQueryThreads(scope.projectId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('managerQueriesTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('managerQueriesHelp')}</p>
      </div>
      <QueryQueue
        threads={threads}
        locale={locale}
        viewerSide="TEAM"
        emptyMessage={t('queriesEmpty')}
      />
    </div>
  );
}
