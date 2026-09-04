'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

export interface PartOption {
  id: string;
  nameFa: string;
  nameEn: string;
  sortOrder: number;
}

export type PartSelection = Record<string, number>;

/**
 * Tap-to-select part picker (§4.4 — "favor tap-to-select over free typing everywhere
 * possible"). Two independent instances are rendered: one for replaced parts, one for
 * repaired parts, because the same part can legitimately appear in both lists on one
 * visit and they are billed differently (§6.8).
 *
 * Selections are mirrored into hidden inputs so the whole form still submits as plain
 * multipart — no client-side JSON assembly to get out of sync with the server.
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
  const locale = useLocale();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter(
      (p) => p.nameFa.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q),
    );
  }, [parts, query]);

  const selectedCount = Object.keys(value).length;

  const toggle = (id: string) => {
    const next = { ...value };
    if (next[id]) delete next[id];
    else next[id] = 1;
    onChange(next);
  };

  const setQty = (id: string, qty: number) => {
    const clamped = Math.max(1, Math.min(99, qty));
    onChange({ ...value, [id]: clamped });
  };

  const nameOf = (p: PartOption) => (locale === 'fa' ? p.nameFa : p.nameEn);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-900">{title}</h3>
        <span className="text-xs text-[var(--muted)]">
          {t('selectedCount', { count: selectedCount })}
        </span>
      </div>
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
          return (
            <div
              key={part.id}
              className={clsx(
                'rounded-lg border p-2 transition-colors',
                selected
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-[var(--border)] bg-white',
              )}
            >
              <button
                type="button"
                onClick={() => toggle(part.id)}
                className="block w-full text-start text-xs font-medium leading-5 text-slate-800"
              >
                {nameOf(part)}
              </button>

              {selected ? (
                <div className="mt-2 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label="-"
                    onClick={() => setQty(part.id, qty - 1)}
                    className="h-7 w-7 rounded-md border border-brand-200 bg-white text-sm font-bold text-brand-700"
                  >
                    −
                  </button>
                  <input
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => setQty(part.id, Number(e.target.value.replace(/\D/g, '')) || 1)}
                    className="dir-ltr h-7 w-10 rounded-md border border-brand-200 text-center text-sm tabular-nums"
                  />
                  <button
                    type="button"
                    aria-label="+"
                    onClick={() => setQty(part.id, qty + 1)}
                    className="h-7 w-7 rounded-md border border-brand-200 bg-white text-sm font-bold text-brand-700"
                  >
                    +
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {Object.entries(value).map(([partId, qty]) => (
        <input key={partId} type="hidden" name={fieldName} value={`${action}:${partId}:${qty}`} />
      ))}
    </section>
  );
}
