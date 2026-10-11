'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Text size, per device. Scales the root font size, which every rem-based size and gap in
 * the app follows — so the whole page grows evenly, unlike the browser's own zoom it
 * survives a reload, and touch positions (the signature pad) stay exact.
 *
 * The saved choice is applied before first paint by FONT_SCALE_SCRIPT in the root layout;
 * this control only changes it.
 */
export const FONT_SCALE_KEY = 'sazkara.fontScale';
const STEPS = [0.875, 1, 1.125, 1.25, 1.375, 1.5];

/** Inlined into <head>: apply the saved size before anything renders. */
export const FONT_SCALE_SCRIPT = `try{var s=parseFloat(localStorage.getItem('${FONT_SCALE_KEY}'));if(s>0.5&&s<2)document.documentElement.style.fontSize=(s*100)+'%'}catch(e){}`;

const CHANGED = 'sazkara:font-scale';

/** The size in effect, read from the page itself so it is right even without storage. */
function readScale(): number {
  const pct = parseFloat(document.documentElement.style.fontSize);
  const scale = Number.isFinite(pct) ? pct / 100 : 1;
  return STEPS.includes(scale) ? scale : 1;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

function apply(scale: number) {
  document.documentElement.style.fontSize = scale === 1 ? '' : `${scale * 100}%`;
  try {
    if (scale === 1) localStorage.removeItem(FONT_SCALE_KEY);
    else localStorage.setItem(FONT_SCALE_KEY, String(scale));
  } catch {
    // Private mode or blocked storage: the size still applies for this visit.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function FontSizeControl() {
  const t = useTranslations('app');
  // The server renders the default; the browser reads what the head script applied.
  const scale = useSyncExternalStore(subscribe, readScale, () => 1);

  const step = (dir: -1 | 1) => {
    const i = STEPS.indexOf(scale);
    apply(STEPS[Math.min(STEPS.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))]);
  };

  const btn =
    'flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 font-semibold text-white/90 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent';

  return (
    <div className="flex items-center rounded-lg border border-white/20" role="group" aria-label={t('textSize')}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={scale === STEPS[0]}
        className={`${btn} text-xs`}
        title={t('textSmaller')}
        aria-label={t('textSmaller')}
      >
        A−
      </button>
      <span aria-hidden className="h-4 w-px bg-white/20" />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={scale === STEPS[STEPS.length - 1]}
        className={`${btn} text-base`}
        title={t('textLarger')}
        aria-label={t('textLarger')}
      >
        A+
      </button>
    </div>
  );
}
