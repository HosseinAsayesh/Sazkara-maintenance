'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';

export interface StandTab {
  label: string;
  /** Whether this stand has enough on it to submit — parts, or a not-repaired reason. */
  ready: boolean;
  /** Extra stands can be taken back off; the store's first stand cannot. */
  removable?: boolean;
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
  onRemove,
  canAdd,
}: {
  tabs: StandTab[];
  active: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  /** Index into `tabs`; only called for tabs marked removable. */
  onRemove: (index: number) => void;
  canAdd: boolean;
}) {
  const t = useTranslations('form');

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab, i) => {
        const isActive = i === active;
        return (
          // Relative wrapper so the removal control can sit on the tab: a button cannot
          // be nested inside another button, and the tab itself is one.
          <div key={i} className="relative min-w-[7.5rem] flex-1">
            <button
              type="button"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelect(i)}
              className={clsx(
                'w-full rounded-[10px] border-2 p-3 text-center transition-colors',
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

            {/* A stand added by a mistaken tap has to be removable from the tab, which is
                where the technician is looking when they realise. The button in the panel
                header below is easy to miss on a phone, and until the stand is gone the
                form refuses to submit — so a missed escape reads as being trapped in a
                second form that should never have existed. */}
            {tab.removable ? (
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={t('removeStand')}
                title={t('removeStand')}
                className={clsx(
                  'absolute end-1 top-1 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none transition-colors',
                  isActive
                    ? 'text-white/80 hover:bg-white/20 hover:text-white'
                    : 'text-teal-700/70 hover:bg-teal-100 hover:text-red-700',
                )}
              >
                &times;
              </button>
            ) : null}
          </div>
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
