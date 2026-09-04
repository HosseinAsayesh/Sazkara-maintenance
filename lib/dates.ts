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

/**
 * §6.3 — no longer the definition of a re-repair (the project boundary is), but kept as
 * the "quick re-repair" threshold: a stand that failed again this fast is a different
 * quality signal from one that lasted the whole campaign.
 */
export const RE_REPAIR_WINDOW_DAYS = 14;

/* ------------------------------------------------------------------ *
 * Jalali → Gregorian
 *
 * The forward direction above goes through Intl. Rather than add a second, independent
 * calendar algorithm that could disagree with it at the edges, the inverse is solved by
 * correcting a close estimate against that same forward conversion — so the two
 * directions cannot drift apart by construction.
 * ------------------------------------------------------------------ */

export const JALALI_MONTHS_FA = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** Persian weeks start on Saturday. */
export const JALALI_WEEKDAYS_FA = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/** 1-based day of the Jalali year: months 1-6 have 31 days, 7-11 have 30, 12 has 29/30. */
function jalaliDayOfYear(month: number, day: number): number {
  return (month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30) + day;
}

/**
 * The UTC instant of Tehran-local midnight on a given Jalali date.
 * Throws rather than returning a silently wrong day if the correction fails to converge.
 */
export function jalaliToDate(
  year: number,
  month: number,
  day: number,
  timeZone = APP_TIMEZONE,
): Date {
  const targetDoy = jalaliDayOfYear(month, day);

  // A Jalali year begins around 20 March of (year + 621).
  let guess = Date.UTC(year + 621, 2, 20, 12) + (targetDoy - 1) * DAY_MS;

  /** >0 when the target is after `p`, <0 when before, 0 when identical. */
  const compare = (p: JalaliParts) => {
    if (p.year !== year) return year - p.year;
    if (p.month !== month) return month - p.month;
    return day - p.day;
  };

  for (let i = 0; i < 12; i++) {
    const p = toJalaliParts(new Date(guess), timeZone);
    const direction = compare(p);
    if (direction === 0) return startOfLocalDay(new Date(guess), timeZone);

    // The jump treats every Jalali year as 365 days, which is one short whenever the
    // span crosses a 366-day leap year — around Nowruz that makes the estimate land on
    // the last day of the previous year and the naive delta evaluate to zero. When the
    // estimate says "no move" but the dates still differ, step a single day in the
    // direction `compare` proves is correct, so the loop always makes progress.
    const approxDelta =
      (year - p.year) * 365 + (targetDoy - jalaliDayOfYear(p.month, p.day));
    guess += (approxDelta !== 0 ? approxDelta : Math.sign(direction)) * DAY_MS;
  }

  throw new Error(`Could not resolve Jalali date ${year}/${month}/${day}`);
}

/** True when the Jalali date actually exists (e.g. 1403/12/30 does, 1404/12/30 doesn't). */
export function isValidJalaliDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  try {
    const p = toJalaliParts(jalaliToDate(year, month, day));
    return p.year === year && p.month === month && p.day === day;
  } catch {
    return false;
  }
}

/** Number of days in a Jalali month — 29 or 30 for Esfand depending on the leap year. */
export function jalaliMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return isValidJalaliDate(year, 12, 30) ? 30 : 29;
}

/**
 * Weekday index of the 1st of a Jalali month, 0 = Saturday — the offset a month grid
 * needs before its first cell.
 */
export function jalaliMonthStartWeekday(year: number, month: number): number {
  const d = jalaliToDate(year, month, 1);
  // JS getUTCDay: 0 = Sunday. Persian weeks start Saturday, so shift by one.
  const gregorianDow = new Date(d.getTime() + 12 * 3600 * 1000).getUTCDay();
  return (gregorianDow + 1) % 7;
}

/** `1404/06/13` (Latin digits) -> the ISO Gregorian day string the filters already use. */
export function jalaliStringToIso(input: string): string | null {
  const parts = toLatinDigits(input).split(/[/\-.]/).map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  if (!isValidJalaliDate(y, m, d)) return null;
  return formatGregorian(jalaliToDate(y, m, d));
}

/** The inverse: an ISO Gregorian day string -> `1404/06/13`. */
export function isoToJalaliString(iso: string, persianDigits = false): string {
  return formatJalali(new Date(`${iso}T12:00:00Z`), { persianDigits });
}
