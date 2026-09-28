import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { QueryListItem } from '@/lib/client-view';
import { formatDateForLocale } from '@/lib/dates';

import { QueryThread } from './QueryThread';

/**
 * Every thread in the campaign, for whichever side is looking.
 *
 * One component again, for the reason that runs through this whole panel: a separate
 * manager list would be free to show a thread Jti cannot see, and the point of the
 * feature is that one conversation has one record.
 */
export async function QueryQueue({
  threads,
  locale,
  viewerSide,
  emptyMessage,
}: {
  threads: QueryListItem[];
  locale: string;
  viewerSide: 'CLIENT' | 'TEAM';
  emptyMessage: string;
}) {
  const t = await getTranslations({ locale, namespace: 'client' });

  if (threads.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  return (
    <ul className="space-y-4">
      {threads.map((thread) => (
        <li key={thread.id} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <Link
              href={`/client/form/${thread.formId}`}
              className="font-semibold text-teal-700 hover:underline dir-ltr"
            >
              {thread.formCode}
            </Link>
            <span className="text-[var(--muted)]">
              <span className="dir-ltr">{thread.uid}</span> · {thread.storeName} ·{' '}
              {thread.cityName} · {formatDateForLocale(thread.date, locale)}
            </span>
          </div>
          <QueryThread
            locale={locale}
            queryId={thread.id}
            status={thread.status}
            messages={thread.messages}
            viewerSide={viewerSide}
          />
        </li>
      ))}
      <li className="text-xs text-[var(--muted)]">{t('queriesListNote')}</li>
    </ul>
  );
}
