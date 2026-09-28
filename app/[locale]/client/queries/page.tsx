import { getTranslations, setRequestLocale } from 'next-intl/server';

import { QueryQueue } from '@/components/client/QueryQueue';
import { Alert } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { getClientScope, getQueryThreads } from '@/lib/client-view';

export default async function ClientQueriesPage({
  params,
}: PageProps<'/[locale]/client/queries'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const threads = await getQueryThreads(scope.projectId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900">{t('queriesTitle')}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{t('queriesHelp')}</p>
      </div>
      <QueryQueue
        threads={threads}
        locale={locale}
        viewerSide={user.role === 'CLIENT_SUPERVISOR' ? 'CLIENT' : 'TEAM'}
        emptyMessage={t('queriesEmpty')}
      />
    </div>
  );
}
