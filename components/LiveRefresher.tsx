'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * §7 — "must update in near-real-time as technicians submit forms".
 *
 * A poll rather than a socket: the dashboard is a handful of aggregate queries against a
 * local Postgres, the manager is one user, and this keeps the deployment to a single
 * Next process with nothing extra to run. Polling pauses while the tab is hidden so a
 * dashboard left open overnight isn't hammering the database.
 */
const INTERVAL_MS = 20_000;

export function LiveRefresher() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setLastUpdated(new Date());
    };

    const id = setInterval(tick, INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, router]);

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
      {lastUpdated ? (
        <span>
          {t('lastUpdated', {
            time: lastUpdated.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          })}
        </span>
      ) : null}
      <label className="inline-flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t('live')}
      </label>
      <button
        type="button"
        onClick={() => {
          router.refresh();
          setLastUpdated(new Date());
        }}
        className="rounded-md border border-[var(--border)] bg-white px-2 py-1 font-medium text-slate-600 hover:bg-brand-50"
      >
        {tc('refresh')}
      </button>
    </div>
  );
}
