/**
 * Text normalisation.
 *
 * Persian text arrives from three uncontrolled sources — Jti's spreadsheets, technicians
 * typing on phone keyboards, and historical exports — which disagree about Arabic vs
 * Persian letter forms, Arabic vs Persian digits, and zero-width non-joiners. Every
 * identity comparison in the app (uid equality, "is this the same store?") goes through
 * these helpers, otherwise the same store or stand shows up twice.
 *
 * Codepoints are written as escapes on purpose: several of these characters are
 * invisible or combining, and a literal would be impossible to review in a diff.
 */

const ZWNJ = '‌';
const ARABIC_YEH = 'ي';
const PERSIAN_YEH = 'ی';
const ARABIC_KAF = 'ك';
const PERSIAN_KAF = 'ک';

/** Arabic letter forms -> the Persian form used consistently in our data. */
const LETTER_FOLD: Record<string, string> = {
  [ARABIC_YEH]: PERSIAN_YEH,
  'ئ': PERSIAN_YEH, // yeh with hamza
  [ARABIC_KAF]: PERSIAN_KAF,
  'ة': 'ه', // teh marbuta -> heh
  'أ': 'ا', // alef with hamza above
  'إ': 'ا', // alef with hamza below
  'آ': 'ا', // alef madda
  'ؤ': 'و', // waw with hamza
};

const LETTER_FOLD_RE = new RegExp(`[${Object.keys(LETTER_FOLD).join('')}]`, 'g');

/** Harakat / tatweel — decorative, never meaningful for matching. */
const DIACRITICS_RE = /[ً-ْٰـ]/g;

/** Persian (U+06F0..) and Arabic-Indic (U+0660..) digits -> ASCII. */
export function toLatinDigits(input: string): string {
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Unify letter forms, digits and spacing without changing meaning. */
export function normalisePersian(input: string): string {
  return toLatinDigits(input)
    .replace(LETTER_FOLD_RE, (ch) => LETTER_FOLD[ch] ?? ch)
    .replace(DIACRITICS_RE, '')
    .split(ZWNJ)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical form of a stand uid. Jti's codes are alphanumeric; case, surrounding
 * whitespace, internal separators and digit script must never create a second stand.
 */
export function normaliseUid(input: string): string {
  return toLatinDigits(input)
    .split(ZWNJ)
    .join('')
    .replace(/[\s._/\\-]+/g, '')
    .trim()
    .toUpperCase();
}

/** Key used to decide whether an imported row refers to a store we already have. */
export function makeStoreMatchKey(name: string): string {
  return normalisePersian(name).toLowerCase().replace(/\s+/g, '');
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

/** `undefined` for blank cells, so Prisma leaves the column alone instead of nulling it. */
export function cleanOptional(v: unknown): string | undefined {
  if (isBlank(v)) return undefined;
  return String(v).trim();
}
