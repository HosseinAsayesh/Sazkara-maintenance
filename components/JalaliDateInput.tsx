'use client';

import clsx from 'clsx';
import { useLocale } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  JALALI_MONTHS_FA,
  JALALI_WEEKDAYS_FA,
  formatGregorian,
  jalaliMonthLength,
  jalaliMonthStartWeekday,
  jalaliToDate,
  toJalaliParts,
  toPersianDigits,
} from '@/lib/dates';

import { Input } from './ui';

/**
 * Date field for the manager's filters.
 *
 * Under the Persian locale this is a real Shamsi calendar: the manager picks
 * ۱۴۰۴/۰۶/۱۳, not a Gregorian date they have to convert in their head. Under English it
 * falls back to the browser's native picker.
 *
 * Either way the value handed to the parent is an ISO Gregorian `YYYY-MM-DD` string, so
 * every existing filter, query-string and export keeps working untouched — the calendar
 * is a presentation layer over the storage format, not a change to it.
 */
export function JalaliDateInput({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** ISO Gregorian `YYYY-MM-DD`, or '' for empty. */
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => toJalaliParts(new Date()), []);

  const selected = useMemo(() => {
    if (!value) return null;
    const d = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return toJalaliParts(d);
  }, [value]);

  const [view, setView] = useState(() => ({
    year: selected?.year ?? today.year,
    month: selected?.month ?? today.month,
  }));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // English locale: the native control is already correct and familiar.
  if (locale !== 'fa') {
    return (
      <Input
        type="date"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx('dir-ltr', className)}
      />
    );
  }

  /**
   * Centre the calendar on the selected date each time it opens. Doing this on open
   * rather than in an effect keeps the month the user paged to while the popup is
   * still up, and avoids a setState-during-effect cascade.
   */
  const togglePicker = () => {
    if (!open) {
      setView({
        year: selected?.year ?? today.year,
        month: selected?.month ?? today.month,
      });
    }
    setOpen(!open);
  };

  const monthLength = jalaliMonthLength(view.year, view.month);
  const leading = jalaliMonthStartWeekday(view.year, view.month);

  const shift = (months: number) => {
    const total = view.year * 12 + (view.month - 1) + months;
    setView({ year: Math.floor(total / 12), month: (total % 12) + 1 });
  };

  const pick = (day: number) => {
    onChange(formatGregorian(jalaliToDate(view.year, view.month, day)));
    setOpen(false);
  };

  const label = selected
    ? toPersianDigits(
        `${selected.year}/${String(selected.month).padStart(2, '0')}/${String(
          selected.day,
        ).padStart(2, '0')}`,
      )
    : '';

  return (
    <div className={clsx('relative', className)} ref={wrapRef}>
      <Input
        type="text"
        readOnly
        aria-label={ariaLabel}
        value={label}
        placeholder="—"
        onClick={togglePicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePicker();
          }
        }}
        className="cursor-pointer"
      />

      {value ? (
        <button
          type="button"
          aria-label="حذف تاریخ"
          onClick={() => onChange('')}
          className="absolute inset-y-0 end-2 my-auto h-5 w-5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ×
        </button>
      ) : null}

      {open ? (
        <div className="absolute z-30 mt-1 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="ماه قبل"
              className="h-7 w-7 rounded-md text-slate-600 hover:bg-slate-100"
            >
              ‹
            </button>
            <div className="text-sm font-semibold text-brand-900">
              {JALALI_MONTHS_FA[view.month - 1]} {toPersianDigits(view.year)}
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="ماه بعد"
              className="h-7 w-7 rounded-md text-slate-600 hover:bg-slate-100"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500">
            {JALALI_WEEKDAYS_FA.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leading }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: monthLength }).map((_, i) => {
              const day = i + 1;
              const isSelected =
                selected?.year === view.year &&
                selected?.month === view.month &&
                selected?.day === day;
              const isToday =
                today.year === view.year &&
                today.month === view.month &&
                today.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  className={clsx(
                    'h-8 rounded-md text-xs transition-colors',
                    isSelected
                      ? 'bg-brand-600 font-semibold text-white'
                      : isToday
                        ? 'bg-brand-50 font-semibold text-brand-700'
                        : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(formatGregorian(new Date()));
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              امروز
            </button>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              پاک کردن
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
