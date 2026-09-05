'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';

export interface StandTab {
  label: string;
  /** Whether this stand has enough on it to submit — parts, or a not-repaired reason. */
  ready: boolean;
}

/**
 * Switches between the stands at one store.
 *
 * A store carries one uid and up to three stands, and each stand's block is long: parts,
 * quality, its own before/after photos. Stacked, a technician finishing stand 1 has to
 * scroll past all of it to reach stand 2, and nothing on screen says whether stand 2 has
 * been touched. The tabs make that state visible at a glance.
 *
 * Only the panels are switched — never unmounted. Hiding with CSS keeps every field, and
 * every already-chosen photo, in the form and therefore in the submitted FormData.
 */
export function StandTabs({
  tabs,
  active,
  onSelect,
  onAdd,
  canAdd,
}: {
  tabs: StandTab[];
  active: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  canAdd: boolean;
}) {
  const t = useTranslations('form');

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            aria-current={isActive ? 'true' : undefined}
            onClick={() => onSelect(i)}
            className={clsx(
              'min-w-[7.5rem] flex-1 rounded-[10px] border-2 p-3 text-center transition-colors',
              isActive
                ? 'border-brand-600 bg-brand-600 text-white'
                : tab.ready
                  ? 'border-teal-200 bg-teal-50 text-teal-700 hover:border-teal-400'
                  : 'border-dashed border-teal-200 bg-teal-50 text-teal-700 hover:border-teal-400',
            )}
          >
            <div className="text-[15px] font-semibold">{tab.label}</div>
            <div className={clsx('mt-0.5 text-[11px]', isActive && 'opacity-75')}>
              {tab.ready ? t('standReady') : t('standIncomplete')}
            </div>
          </button>
        );
      })}

      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="min-w-[7.5rem] flex-1 rounded-[10px] border-2 border-dashed border-[var(--border)] p-3 text-center text-[13px] font-medium text-[var(--muted)] transition-colors hover:border-brand-400 hover:text-brand-700"
        >
          + {t('addStand')}
        </button>
      ) : null}
    </div>
  );
}
