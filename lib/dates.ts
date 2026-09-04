/**
 * Date handling.
 *
 * Decision (confirmed with the client): timestamps are stored as UTC in Postgres and
 * converted only at the edges. The Jti export (column 2, تاریخ) and the evidence PDFs
 * use the Jalali/Shamsi calendar; the UI shows Jalali under the `fa` locale and
 * Gregorian under `en`.
 *
 * Conversion goes through `Intl` with the `persian` calendar, which ships with Node's
 * full-ICU build — no date library, no drift against a hand-rolled algorithm.
 *
 * "Day" boundaries (the daily evidence PDF, the dashboard's "today", the date-range
 * export) are Tehran-local, not UTC — a form submitted at 02:00 Tehran belongs to that
 * Tehran day.
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Tehran';

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // Persian
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // Arabic-Indic
}

function parts(date: Date, calendar: 'persian' | 'gregory', timeZone = APP_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: Number(toLatinDigits(out.year ?? '0').replace(/[^0-9]/g, '')),
    month: Number(out.month ?? '0'),
    day: Number(out.day ?? '0'),
  };
}

export interface JalaliParts {
  year: number;
  month: number;
  day: number;
}

export function toJalaliParts(date: Date, timeZone = APP_TIMEZONE): JalaliParts {
  return parts(date, 'persian', timeZone);
}

/**
 * `۱۴۰۴/۰۶/۱۳` (Persian digits) or `1404/06/13` (Latin).
 * This is the string written into export column 2.
 */
export function formatJalali(
  date: Date,
  opts: { persianDigits?: boolean; timeZone?: string } = {},
): string {
  const { year, month, day } = toJalaliParts(date, opts.timeZone ?? APP_TIMEZONE);
  const s = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  return opts.persianDigits ? toPersianDigits(s) : s;
}

/** `2026-09-04` in the app timezone. */
export function formatGregorian(date: Date, timeZone = APP_TIMEZONE): string {
  const { year, month, day } = parts(date, 'gregory', timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Locale-aware date for UI: Jalali for `fa`, Gregorian for everything else. */
export function formatDateForLocale(date: Date, locale: string): string {
  return locale === 'fa'
    ? formatJalali(date, { persianDigits: true })
    : formatGregorian(date);
}

export function formatDateTimeForLocale(date: Date, locale: string): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const d = formatDateForLocale(date, locale);
  return locale === 'fa' ? `${d} - ${toPersianDigits(time)}` : `${d} ${time}`;
}

/* ------------------------------------------------------------------ *
 * Tehran-local day boundaries
 * ------------------------------------------------------------------ */

/** Offset of `timeZone` from UTC at `date`, in minutes (positive = ahead of UTC). */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Format the instant in the target zone, re-read it as if it were UTC, and diff.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) === 24 ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Instant of 00:00:00 on the app-timezone day that `date` falls in.
 * Iterated twice so a DST change on the boundary still lands correctly.
 */
export function startOfLocalDay(date: Date, timeZone = APP_TIMEZONE): Date {
  const { year, month, day } = parts(date, 'gregory', timeZone);
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(new Date(guess), timeZone);
    guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - off * 60000;
  }
  return new Date(guess);
}

/** Exclusive upper bound: 00:00 of the next app-timezone day. */
export function endOfLocalDayExclusive(date: Date, timeZone = APP_TIMEZONE): Date {
  const start = startOfLocalDay(date, timeZone);
  return startOfLocalDay(new Date(start.getTime() + 36 * 3600 * 1000), timeZone);
}

/**
 * Turn the `YYYY-MM-DD` values an `<input type="date">` produces into a half-open
 * UTC range `[from, to)` covering those Tehran-local days inclusive.
 */
export function localDayRange(fromIso?: string | null, toIso?: string | null) {
  const from = fromIso ? startOfLocalDay(new Date(`${fromIso}T12:00:00Z`)) : undefined;
  const to = toIso ? endOfLocalDayExclusive(new Date(`${toIso}T12:00:00Z`)) : undefined;
  return { from, to };
}

/** Key used to group forms into evidence-PDF days: `2026-09-04`, Tehran-local. */
export function localDayKey(date: Date, timeZone = APP_TIMEZONE): string {
  return formatGregorian(date, timeZone);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** §6.3 — the re-repair window. */
export const RE_REPAIR_WINDOW_DAYS = 14;
