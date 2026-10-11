'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

export interface PartOption {
  id: string;
  nameFa: string;
  nameEn: string;
  sortOrder: number;
  /** PIECE for most parts; CENTIMETER for the SMD strips and wires. */
  unit: 'PIECE' | 'CENTIMETER';
  /** 1 for pieces, 30 for the SMD strips, 10 for the wires (centimetres). */
  quantityStep: number;
  /** Repair work with no part (soldering, gluing...): never offered as a replaced part. */
  repairOnly?: boolean;
}

export type PartSelection = Record<string, number>;

/** Upper bounds are generous but finite, to catch a stuck finger on the + button. */
const MAX_PIECES = 99;
const MAX_CENTIMETERS = 5000;

/**
 * Tap-to-select part picker (§4.4 — "favor tap-to-select over free typing everywhere
 * possible").
 *
 * Two instances are rendered per stand: one for REPLACED parts, one for REPAIRED. They
 * are styled as visibly separate panels — different accent colour, own header band and
 * a heavier border — because the same part can legitimately appear in both on one visit
 * and the two are billed completely differently (§6.8: only replaced parts are consumed
 * inventory). A technician mistaking one panel for the other corrupts the parts bill, so
 * the distinction is carried by colour and layout rather than by a caption alone.
 *
 * Quantities step in the part's own unit: pieces one at a time, SMD strip in 30 cm cuts,
 * wire in 10 cm. Stepping below the smallest amount removes the part.
 *
 * Selections mirror into hidden inputs so the form still submits as plain multipart —
 * no client-side JSON assembly to drift out of sync with the server.
 */
export function PartPicker({
  parts,
  action,
  fieldName,
  title,
  help,
  value,
  onChange,
}: {
  parts: PartOption[];
  action: 'REPLACED' | 'REPAIRED';
  fieldName: string;
  title: string;
  help: string;
  value: PartSelection;
  onChange: (next: PartSelection) => void;
}) {
  const t = useTranslations('form');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [query, setQuery] = useState('');

  const isReplace = action === 'REPLACED';

  const filtered = useMemo(() => {
    // Repair-only work (soldering, gluing...) consumes no part, so it can never be
    // "replaced"; the repaired list is the only place it belongs.
    const offered = isReplace ? parts.filter((p) => !p.repairOnly) : parts;
    const q = query.trim().toLowerCase();
    if (!q) return offered;
    return offered.filter(
      (p) => p.nameFa.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q),
    );
  }, [parts, query, isReplace]);

  const selectedCount = Object.keys(value).length;

  const stepOf = (part: PartOption) => Math.max(1, part.quantityStep || 1);
  const maxOf = (part: PartOption) =>
    part.unit === 'CENTIMETER' ? MAX_CENTIMETERS : MAX_PIECES;

  const toggle = (part: PartOption) => {
    const next = { ...value };
    if (next[part.id]) delete next[part.id];
    else next[part.id] = stepOf(part);
    onChange(next);
  };

  const setQty = (part: PartOption, qty: number) => {
    const step = stepOf(part);
    // Snap to the nearest whole step so a typed "137" becomes a cuttable 150 cm.
    const snapped = Math.round(qty / step) * step;
    const clamped = Math.max(step, Math.min(maxOf(part), snapped));
    onChange({ ...value, [part.id]: clamped });
  };

  /**
   * The − button. Below the smallest amount it removes the part, so "1 fuse -> none" is
   * the same tap as "2 fuses -> 1". It used to stop at the minimum, which read as a dead
   * button — and the only way out was tapping the name above it.
   */
  const decrement = (part: PartOption, qty: number) => {
    const step = stepOf(part);
    if (qty - step < step) {
      const next = { ...value };
      delete next[part.id];
      onChange(next);
    } else {
      setQty(part, qty - step);
    }
  };

  const nameOf = (p: PartOption) => (locale === 'fa' ? p.nameFa : p.nameEn);
  const unitLabel = (p: PartOption) =>
    p.unit === 'CENTIMETER' ? tc('centimeter') : tc('piece');

  return (
    <section
      className={clsx(
        'overflow-hidden rounded-xl border-2 bg-[var(--surface)]',
        isReplace ? 'border-amber-700' : 'border-teal-700',
      )}
    >
      <header
        className={clsx(
          'flex flex-wrap items-baseline justify-between gap-2 border-b-2 px-4 py-2.5',
          isReplace
            ? 'border-amber-700 bg-amber-100'
            : 'border-teal-700 bg-teal-100',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white',
              isReplace ? 'bg-amber-700' : 'bg-teal-700',
            )}
            aria-hidden
          >
            {isReplace ? '⇄' : '✚'}
          </span>
          <h3
            className={clsx(
              'text-sm font-bold',
              isReplace ? 'text-amber-900' : 'text-teal-900',
            )}
          >
            {title}
          </h3>
        </div>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            isReplace ? 'bg-amber-200 text-amber-900' : 'bg-teal-200 text-teal-900',
          )}
        >
          {t('selectedCount', { count: selectedCount })}
        </span>
      </header>

      <div className="p-4">
        <p className="mb-3 text-xs text-[var(--muted)]">{help}</p>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('tapToSelect')}
          className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((part) => {
            const qty = value[part.id];
            const selected = qty !== undefined;
            const step = stepOf(part);
            const isCm = part.unit === 'CENTIMETER';

            return (
              <div
                key={part.id}
                className={clsx(
                  'rounded-lg border p-2 transition-colors',
                  selected
                    ? isReplace
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-teal-400 bg-teal-50'
                    : 'border-[var(--border)] bg-white',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(part)}
                  className="block w-full text-start text-xs font-medium leading-5 text-brand-700"
                >
                  {nameOf(part)}
                  {isCm ? (
                    <span className="mt-0.5 block text-[0.625rem] font-normal text-[var(--muted)]">
                      {t('cmHint', { step })}
                    </span>
                  ) : null}
                </button>

                {/* Tap targets are a full 40px and sit in their own row with a gap above,
                    so a thumb on − cannot land on the name button instead — the name
                    toggles the whole part off, which is what "the − only works a few
                    pixels higher" was. touch-manipulation drops the double-tap-zoom
                    delay that made quick taps feel ignored. */}
                {selected ? (
                  <div className="mt-2.5 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      aria-label="-"
                      onClick={() => decrement(part, qty)}
                      className={clsx(
                        'h-10 w-10 shrink-0 touch-manipulation rounded-md border bg-white text-lg font-bold',
                        isReplace
                          ? 'border-amber-300 text-amber-700'
                          : 'border-teal-300 text-teal-700',
                      )}
                    >
                      −
                    </button>
                    <span className="flex items-baseline gap-0.5">
                      <input
                        inputMode="numeric"
                        value={qty}
                        aria-label={`${nameOf(part)} — ${unitLabel(part)}`}
                        onChange={(e) =>
                          setQty(part, Number(e.target.value.replace(/\D/g, '')) || step)
                        }
                        className={clsx(
                          'dir-ltr h-10 rounded-md border text-center text-sm tabular-nums',
                          isCm ? 'w-12' : 'w-10',
                          isReplace ? 'border-amber-300' : 'border-teal-300',
                        )}
                      />
                      {isCm ? (
                        <span className="text-[0.625rem] text-[var(--muted)]">
                          {tc('centimeter')}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      aria-label="+"
                      onClick={() => setQty(part, qty + step)}
                      className={clsx(
                        'h-10 w-10 shrink-0 touch-manipulation rounded-md border bg-white text-lg font-bold',
                        isReplace
                          ? 'border-amber-300 text-amber-700'
                          : 'border-teal-300 text-teal-700',
                      )}
                    >
                      +
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {Object.entries(value).map(([partId, qty]) => (
        <input key={partId} type="hidden" name={fieldName} value={`${action}:${partId}:${qty}`} />
      ))}
    </section>
  );
}
