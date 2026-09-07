import 'server-only';

import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

import { resolveCityId as resolveCityByName } from './cities';
import { nextFormCode } from './codes';
import { DAY_MS } from './dates';
import {
  JTI_EXPORT_HEADERS,
  LEGACY_PART_COLUMN_COUNT,
  LEGACY_TO_CURRENT_SORT_ORDER,
  PART_CATALOG,
} from './parts';
import { prisma } from './prisma';
import { getStorage } from './storage';
import { cleanOptional, makeStoreMatchKey, normaliseUid, toLatinDigits } from './text';

/**
 * §7 — import previously-completed Jti export files (from before this system existed)
 * so historical work counts toward stats and analytics.
 *
 * Input is the same layout this app *produces* (§8). Columns are read by position and
 * the repair-status column was appended at 44, so archives exported before it existed
 * still import unchanged — which is the point, since those are the old files.
 * This is the layout the repair
 * manager has archived. Columns are located by position, not by header text, because
 * older files were hand-maintained and their headers drifted; the header row is only
 * used to detect how many rows to skip.
 *
 * Historical rows are recorded as REPAIRED forms with parts marked REPLACED (columns
 * 5–34 are replacement quantities). They carry no photos or signatures — that data never
 * existed on paper — so they are attributed to a dedicated technician account and are
 * excluded from wage totals rather than inventing amounts.
 */

// The four leading columns are identical in every generation of the sheet.
const COL_ROW_NUMBER = 1;
const COL_DATE = 2;
const COL_CITY = 3;
const COL_UID = 4;
const COL_FIRST_PART = 5;

/**
 * Two sheet layouts exist in the wild and they are NOT interchangeable:
 *
 *   CURRENT — 4 leading + 30 part columns + 10 trailing.
 *   LEGACY  — 4 leading + 28 part columns +  9 trailing, produced before this system
 *             existed. It has no `سیم نمره ۰.۵`, a single merged `Switch`, and no
 *             repair-status column.
 *
 * Reading a legacy sheet at the current column positions does not fail loudly — it
 * silently shifts everything after the parts by two, so the store name is read out of the
 * technician-code column and part quantities land on the wrong catalogue entries. The
 * layout is therefore detected before a single row is read.
 */
export type ArchiveLayout = 'CURRENT' | 'LEGACY';

/**
 * Which reader to use. Auto-detection is a convenience, not a guarantee: real archives
 * carry hand-edited headers ("location AddresS" instead of "Digital Address") and split
 * their header across two rows, so the manager can always state the format outright.
 * Both remain available permanently — a paper report filed mid-project is transcribed
 * into whichever spreadsheet the office has to hand.
 */
export type ArchiveFormat = 'AUTO' | 'CURRENT' | 'LEGACY';

/**
 * The legacy part headers, column 5 to column 32, each with the spellings actually seen
 * in the client's files.
 *
 * A single expected string per column produced false alarms that were indistinguishable
 * from real ones: «سیم نمره1 یک متر» was reported as a mismatch against «سیم نمره1»
 * although they are the same part, which trains the manager to ignore the warnings —
 * and the one genuine mismatch beside it, «درب» where the sheet says «پک هواکش», was
 * the catalogue actually being wrong. The first spelling is the canonical one.
 */
const LEGACY_PART_HEADER_ALIASES: string[][] = [
  ['شلف پلکسی', 'پلکسی شلف'],
  ['لایت باکس'],
  ['شلف روی در'],
  ['کلیدبرق12Amp', 'کلید برق 12 آمپر'],
  ['سیم نمره1 یک متر', 'سیم نمره1', 'سیم نمره 1', 'سیم نمره ۱ متر'],
  ['پایه فیوز'],
  ['فیوز'],
  ['ترانس'],
  ['میکروسوئیچ', 'میکروسویئچ'],
  ['پایه میکروسیچ', 'پایه میکروسوئیچ', 'پایه میکروسویئچ'],
  ['سیم آداپتوری', 'سیم آداپتور'],
  ['سیم تلفنی'],
  ['سوکت سیم تلفنی'],
  ['کابل3/60', 'کابل ۳/۶۰', 'کابل برق اصلی'],
  ['سنت نگهدارنده در', 'سنت نگهدارنده'],
  ['لایت فریم'],
  ['آرام بند', 'آرام‌بند'],
  ['فنر'],
  ['برد استند'],
  ['(smd)LEDسفید', 'SMD سفید', 'نوار SMD سفید'],
  ['(smd)LEDآبی', 'SMD آبی', 'نوار SMD آبی'],
  ['کلید'],
  ['ریل وپوشرL', 'ریل‌وپوشر L', 'ریل پوشر L'],
  ['ریل وپوشرU', 'ریل و پوشر U', 'ریل پوشر U'],
  ['سوکت کولری'],
  ['درب پلاستیکی شلف', 'درب پلاستیکی'],
  ['پلکسی سفید'],
  // «درب» is accepted because older sheets carry it in this column, but it is the wrong
  // name for the part — see the catalogue note in lib/parts.ts.
  ['پک هواکش', 'درب'],
];

interface ResolvedLayout {
  layout: ArchiveLayout;
  partCount: number;
  /** Zero-based part column offset -> catalogue sortOrder. */
  sortOrderFor: (offset: number) => number | null;
  colDigitalAddress: number;
  colAddress: number;
  colMaintenance: number;
  colTel: number;
  colStore: number;
  colManager: number;
  colTechCode: number;
  colFormCode: number;
  colQuality: number;
  /** Legacy sheets carry a free-text "Store Details" column the current export lacks. */
  colStoreDetails?: number;
}

/**
 * The real legacy sheet, column by column.
 *
 * Its trailing block is NOT the current layout shifted by two: the current export puts
 * `Maintenance detail` third, while the legacy sheet puts `Store Details` there and moves
 * the maintenance feedback to the very end (column 42 / AP), which is where the
 * technician's final review is written. Deriving these positions arithmetically from the
 * current layout — as the previous code did — reads the store name out of the technician
 * code column and the form code out of the feedback column.
 */
const LEGACY_COLUMNS = {
  digitalAddress: 33,
  address: 34,
  storeDetails: 35,
  tel: 36,
  store: 37,
  manager: 38,
  techCode: 39,
  formCode: 40,
  quality: 41,
  /** Column AP — the final review. */
  maintenance: 42,
} as const;

type NotRepairedReasonValue =
  | 'MANAGER_NOT_AUTHORIZED'
  | 'STORE_OR_STAND_REMOVED'
  | 'ALREADY_HEALTHY'
  | 'STORE_TEMPORARILY_CLOSED'
  | 'CONDITION_TOO_POOR';

/**
 * The reason block that follows column AP on real order files (AQ..AX, 43..50).
 *
 * These columns are the only reliable record of an unsuccessful visit. Column AP does
 * carry the reason in prose — "اجازه تعمیر داده نشد."، "استند سالم است." — but it is
 * free text with no fixed wording, so reading the outcome from it means guessing at
 * phrasing. A tick in one of these columns does not.
 *
 * Eight archive reasons collapse onto the five the form offers (§6.5), which is a real
 * loss of nuance, so the archive's own wording is kept verbatim in the notes rather than
 * being thrown away. Extending the enum instead would put reasons in the technician's
 * picker that the spec fixes at five.
 */
const LEGACY_REASON_LABELS: Array<[label: string, reason: NotRepairedReasonValue]> = [
  ['استند سالم', 'ALREADY_HEALTHY'],
  ['تغییر کاربری', 'STORE_OR_STAND_REMOVED'],
  ['تعطیل', 'STORE_TEMPORARILY_CLOSED'],
  ['تقاضای تعویض', 'CONDITION_TOO_POOR'],
  ['عدم امکان تعمیر', 'CONDITION_TOO_POOR'],
  ['عدم صدور اجازه', 'MANAGER_NOT_AUTHORIZED'],
  ['وضعیت نامساعد', 'CONDITION_TOO_POOR'],
  ['آدرس اشتباه', 'STORE_OR_STAND_REMOVED'],
];

export interface ReasonColumn {
  column: number;
  label: string;
  reason: NotRepairedReasonValue;
}

/**
 * Finds the reason block by reading the header row rather than trusting fixed positions.
 *
 * Positions have been stable at 43..50 in every file seen, but these columns were added
 * to the sheet by hand over the years and a shifted block would otherwise be read as
 * "no unsuccessful visits at all" — silently, and in the direction that overstates the
 * work done. Matching on the header means a shift is harmless and an absent block is
 * detected rather than assumed.
 */
function detectReasonColumns(sheet: ExcelJS.Worksheet, headerRow: number): ReasonColumn[] {
  const found: ReasonColumn[] = [];
  const header = sheet.getRow(headerRow);

  for (let column = 1; column <= sheet.columnCount; column++) {
    const text = cellText(header.getCell(column)).trim();
    if (!text) continue;
    const key = makeStoreMatchKey(text);
    const match = LEGACY_REASON_LABELS.find(([label]) => makeStoreMatchKey(label) === key);
    if (match) found.push({ column, label: match[0], reason: match[1] });
  }

  return found;
}

function legacyLayout(): ResolvedLayout {
  return {
    layout: 'LEGACY',
    partCount: LEGACY_PART_COLUMN_COUNT,
    sortOrderFor: (offset) => LEGACY_TO_CURRENT_SORT_ORDER[offset + 1] ?? null,
    colDigitalAddress: LEGACY_COLUMNS.digitalAddress,
    colAddress: LEGACY_COLUMNS.address,
    colMaintenance: LEGACY_COLUMNS.maintenance,
    colTel: LEGACY_COLUMNS.tel,
    colStore: LEGACY_COLUMNS.store,
    colManager: LEGACY_COLUMNS.manager,
    colTechCode: LEGACY_COLUMNS.techCode,
    colFormCode: LEGACY_COLUMNS.formCode,
    colQuality: LEGACY_COLUMNS.quality,
    colStoreDetails: LEGACY_COLUMNS.storeDetails,
  };
}

function buildLayout(partCount: number): ResolvedLayout {
  // Legacy has its own hand-written column map; only the current layout is regular
  // enough to derive positions arithmetically.
  if (partCount === LEGACY_PART_COLUMN_COUNT) return legacyLayout();

  const afterParts = COL_FIRST_PART + partCount;

  return {
    layout: 'CURRENT',
    partCount,
    sortOrderFor: (offset) => PART_CATALOG[offset]?.sortOrder ?? null,
    colDigitalAddress: afterParts,
    colAddress: afterParts + 1,
    colMaintenance: afterParts + 2,
    colTel: afterParts + 3,
    colStore: afterParts + 4,
    colManager: afterParts + 5,
    colTechCode: afterParts + 6,
    colFormCode: afterParts + 7,
    colQuality: afterParts + 8,
  };
}

/**
 * `Digital Address` is the first trailing column and its English header survived every
 * revision of the sheet, so its position tells us exactly how many part columns precede
 * it. Falling back on the raw column count only when the header is unreadable keeps
 * hand-edited archives importable.
 */
/**
 * The address column that opens the trailing block. Real sheets spell it
 * "Digital Address", "location AddresS", or "Location Address" — matching loosely on
 * "address" preceded by "digital"/"location" covers every archive seen so far.
 */
function isTrailingAddressHeader(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return /(digital|location)\s*address/.test(t);
}

function detectLayout(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  format: ArchiveFormat = 'AUTO',
): ResolvedLayout {
  // An explicit choice always wins: auto-detection guesses, the manager knows.
  if (format === 'LEGACY') return legacyLayout();
  if (format === 'CURRENT') return buildLayout(PART_CATALOG.length);

  const width = Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0);

  // The header may be split over two rows (section labels above, part names below), so
  // look for the trailing address column on the header row AND the one after it.
  for (const r of [headerRow, headerRow + 1]) {
    const header = sheet.getRow(r);
    for (let c = COL_FIRST_PART; c <= width; c++) {
      if (!isTrailingAddressHeader(cellText(header.getCell(c)))) continue;
      const partCount = c - COL_FIRST_PART;
      if (partCount === PART_CATALOG.length || partCount === LEGACY_PART_COLUMN_COUNT) {
        return buildLayout(partCount);
      }
      throw new Error(`UNKNOWN_LAYOUT:${partCount}`);
    }
  }

  // No address header. Real sheets leave that cell blank, so fall back to the part-name
  // row: on a two-row header the row under the section labels lists the parts, and the
  // run of non-empty names ends exactly where the trailing block starts. That run length
  // IS the part count, which is far more reliable than the sheet's total width — legacy
  // files carry a varying number of status columns after the feedback column, so they can
  // be wider than a current export and no width test can separate them.
  const namesRow = sheet.getRow(headerRow + 1);
  const looksLikeNames =
    cellText(namesRow.getCell(COL_FIRST_PART)).trim().length > 0 &&
    !Number.isFinite(Number(cellText(namesRow.getCell(COL_FIRST_PART)).trim()));

  if (looksLikeNames) {
    let run = 0;
    for (let c = COL_FIRST_PART; c <= width; c++) {
      if (!cellText(namesRow.getCell(c)).trim()) break;
      run++;
    }
    if (run === PART_CATALOG.length || run === LEGACY_PART_COLUMN_COUNT) {
      return buildLayout(run);
    }
  }

  // Last resort: exact widths for single-header sheets.
  const currentWidth = COL_FIRST_PART + PART_CATALOG.length + 9;
  const legacyWidth = COL_FIRST_PART + LEGACY_PART_COLUMN_COUNT + 9;
  if (width === currentWidth) return buildLayout(PART_CATALOG.length);
  if (width === legacyWidth) return buildLayout(LEGACY_PART_COLUMN_COUNT);

  throw new Error(`AMBIGUOUS_LAYOUT:${width}`);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if (typeof v.text === 'string') return v.text;
    if ('result' in v) return String(v.result ?? '');
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
    }
    if ('hyperlink' in v) return String(v.hyperlink ?? '');
  }
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number {
  const text = toLatinDigits(cellText(value)).replace(/[^\d.-]/g, '');
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Historical sheets carry Jalali dates like `1403/05/12` (and occasionally a real Excel
 * date). Converting Jalali -> Gregorian is done by search over a small candidate window
 * using the same `Intl` calendar the rest of the app formats with, so the round-trip is
 * guaranteed self-consistent and there is no second calendar implementation to drift.
 */
const jalaliFormatter = new Intl.DateTimeFormat('en-u-ca-persian', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function jalaliToDate(jy: number, jm: number, jd: number): Date | null {
  // Jalali year Y starts within Gregorian year Y+621.
  const approx = Date.UTC(jy + 621, 2, 21); // ~Nowruz
  const dayMs = 86400000;

  for (let offset = -400; offset <= 400; offset++) {
    const candidate = new Date(approx + offset * dayMs);
    const parts: Record<string, string> = {};
    for (const p of jalaliFormatter.formatToParts(candidate)) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    if (
      Number(parts.year?.replace(/\D/g, '')) === jy &&
      Number(parts.month) === jm &&
      Number(parts.day) === jd
    ) {
      // Noon UTC keeps the instant safely inside the intended Tehran-local day.
      return new Date(candidate.getTime() + 12 * 3600 * 1000);
    }
  }
  return null;
}

export function parseHistoricalDate(raw: string): Date | null {
  const text = toLatinDigits(String(raw)).trim();
  if (!text) return null;

  // ISO / Excel-serialised dates.
  const iso = Date.parse(text);
  const asJalali = /^(\d{3,4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(text);

  if (asJalali) {
    const [, y, m, d] = asJalali;
    const year = Number(y);
    // A 4-digit year below 1700 is Jalali; anything else is Gregorian.
    if (year < 1700) return jalaliToDate(year, Number(m), Number(d));
    return new Date(Date.UTC(year, Number(m) - 1, Number(d), 12));
  }

  return Number.isNaN(iso) ? null : new Date(iso);
}

export interface HistoricalPreview {
  /** Which sheet generation was detected — shown to the manager before committing. */
  layout: ArchiveLayout;
  /** Part columns whose header disagrees with the catalogue entry behind them. */
  columnWarnings: ColumnWarning[];
  rows: number;
  forms: number;
  /** Successful visits in the file. */
  repaired: number;
  /** Unsuccessful visits, read from the archive's reason columns. */
  notRepaired: number;
  /**
   * Unsuccessful visits by the archive's own wording, so the manager can see at a glance
   * that an import of 1,031 rows really does contain 85 failures — the number that was
   * silently coming through as zero.
   */
  reasonBreakdown: Array<{ label: string; count: number }>;
  /** Distinct uids in the file. A uid is a location, so this is "how many shops". */
  distinctUids: number;
  /** Of those, the ones this system has never seen. */
  newUids: number;
  /** Uids appearing on more than one row — a location visited twice, or a typo. */
  repeatedUids: number;
  newStands: number;
  newStores: number;
  skipped: number;
  firstDate: Date | null;
  lastDate: Date | null;
  sample: Array<{ uid: string; date: string; city: string; parts: number }>;
}

interface HistoricalRow {
  uid: string;
  date: Date;
  cityName: string;
  storeName?: string;
  address?: string;
  digitalAddress?: string;
  managerName?: string;
  phone?: string;
  technicianCode?: string;
  formCode?: string;
  quality: number | null;
  notes?: string;
  outcome: 'REPAIRED' | 'NOT_REPAIRED';
  /** Mapped from the archive's own reason column; null on a successful visit. */
  notRepairedReason: NotRepairedReasonValue | null;
  /** The archive's own wording, before it was collapsed onto the five. */
  archiveReasonLabel: string | null;
  parts: Array<{ sortOrder: number; quantity: number }>;
}

/** A part column whose header does not match the catalogue entry it will be filed under. */
export interface ColumnWarning {
  column: number;
  expected: string;
  found: string;
}

function readRows(
  buffer: Buffer,
  format: ArchiveFormat = 'AUTO',
): Promise<{
  rows: HistoricalRow[];
  skipped: number;
  layout: ArchiveLayout;
  columnWarnings: ColumnWarning[];
}> {
  return (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('NO_SHEET');

    // Detect the header row by looking for a known header, falling back to row 1. The
    // English trailing headers are checked too, because some archives were re-saved with
    // the Persian leading headers translated or stripped.
    let headerRow = 1;
    for (let r = 1; r <= Math.min(8, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const first = cellText(row.getCell(COL_ROW_NUMBER)).trim();
      const second = cellText(row.getCell(COL_DATE)).trim();
      // The uid column header is the most reliable marker: it survived every revision,
      // in Persian ("شناسه") and English ("UID No.") alike.
      const uidHeader = /uid|شناسه/i.test(cellText(row.getCell(COL_UID)));
      const hasEnglishTrailer = (() => {
        const width = Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0);
        for (let c = COL_FIRST_PART; c <= width; c++) {
          if (isTrailingAddressHeader(cellText(row.getCell(c)))) return true;
        }
        return false;
      })();

      if (
        first === JTI_EXPORT_HEADERS[0] ||
        second === JTI_EXPORT_HEADERS[1] ||
        uidHeader ||
        hasEnglishTrailer
      ) {
        headerRow = r;
        break;
      }
    }

    const cols = detectLayout(sheet, headerRow, format);
    const reasonColumns = detectReasonColumns(sheet, headerRow);

    // A legacy sheet spreads its header over two rows: section labels on the first, part
    // names on the second. Data therefore starts one row later than the marker row.
    // Detected rather than assumed, so a single-row variant still imports.
    const partNameRow = sheet.getRow(headerRow + 1);
    const secondRowIsHeader =
      !normaliseUid(cellText(partNameRow.getCell(COL_UID))) &&
      !cellText(partNameRow.getCell(COL_DATE)).trim() &&
      cellText(partNameRow.getCell(COL_FIRST_PART)).trim().length > 0;
    const firstDataRow = headerRow + (secondRowIsHeader ? 2 : 1);

    // Quantities are read by POSITION, so a sheet whose part row differs from the one we
    // expect will file parts against the wrong catalogue entries — silently, because a
    // number in the wrong column is still a valid number. Compare the two and report any
    // mismatch, so the manager sees it in the preview instead of discovering it in the
    // parts bill. Real evidence this matters: one city's sheet ends column 32 with `درب`
    // while another ends it with `پک هواکش`, which is not in the catalogue at all.
    const partHeaderRow = secondRowIsHeader ? partNameRow : sheet.getRow(headerRow);
    const acceptedNames: string[][] =
      cols.layout === 'LEGACY'
        ? LEGACY_PART_HEADER_ALIASES
        : PART_CATALOG.map((p) => [p.nameFa]);

    const columnWarnings: ColumnWarning[] = [];
    for (let offset = 0; offset < cols.partCount; offset++) {
      const column = COL_FIRST_PART + offset;
      const found = cellText(partHeaderRow.getCell(column)).trim();
      if (!found) continue; // an unlabelled column tells us nothing either way
      const accepted = acceptedNames[offset] ?? [];
      const foundKey = makeStoreMatchKey(found);
      if (!accepted.some((name) => makeStoreMatchKey(name) === foundKey)) {
        columnWarnings.push({ column, expected: accepted[0] ?? '', found });
      }
    }

    const rows: HistoricalRow[] = [];
    let skipped = 0;

    for (let r = firstDataRow; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const uid = normaliseUid(cellText(row.getCell(COL_UID)));
      const date = parseHistoricalDate(cellText(row.getCell(COL_DATE)));

      if (!uid || !date) {
        if (uid || cellText(row.getCell(COL_DATE))) skipped++;
        continue;
      }

      // Quantities are read by OFFSET within the part block and then translated to a
      // catalogue sortOrder, so a legacy sheet's 28 columns land on the right parts
      // instead of being shifted onto their neighbours.
      const parts: Array<{ sortOrder: number; quantity: number }> = [];
      for (let offset = 0; offset < cols.partCount; offset++) {
        const sortOrder = cols.sortOrderFor(offset);
        if (sortOrder === null) continue;
        const qty = cellNumber(row.getCell(COL_FIRST_PART + offset).value);
        if (qty > 0) parts.push({ sortOrder, quantity: Math.round(qty) });
      }

      const qualityRaw = cellText(row.getCell(cols.colQuality));
      const quality = qualityRaw ? Math.max(0, Math.min(5, cellNumber(qualityRaw))) : null;

      const feedback = cellText(row.getCell(cols.colMaintenance)).trim();
      const storeDetails = cols.colStoreDetails
        ? cellText(row.getCell(cols.colStoreDetails)).trim()
        : '';

      /*
       * The outcome comes from the reason block, not from the prose in column AP.
       *
       * Reading AP for the word "نبود" missed every unsuccessful visit in the client's
       * real files, because those rows say things like "اجازه تعمیر داده نشد." or
       * "استند سالم است." — and the fallback then defaulted them to REPAIRED. A whole
       * project imported as 100% successful, which is the worst possible direction for
       * this error: it inflates the completion figures the manager reports to Jti.
       *
       * A ticked reason column is unambiguous. In the client's files the two signals
       * never contradict each other — no row carries both parts and a reason — so a tick
       * decides the row outright, and everything else is a repair, including the handful
       * of successful visits that consumed no parts (an adjustment, a re-seated
       * connector) and would otherwise be misfiled as failures.
       */
      const ticked = reasonColumns.filter(
        (rc) => cellText(row.getCell(rc.column)).trim() !== '',
      );

      const outcome: 'REPAIRED' | 'NOT_REPAIRED' =
        ticked.length > 0 ? 'NOT_REPAIRED' : 'REPAIRED';
      const notRepairedReason = ticked[0]?.reason ?? null;

      rows.push({
        uid,
        date,
        cityName: cellText(row.getCell(COL_CITY)).trim() || 'نامشخص',
        storeName: cleanOptional(cellText(row.getCell(cols.colStore))),
        address: cleanOptional(cellText(row.getCell(cols.colAddress))),
        digitalAddress: cleanOptional(cellText(row.getCell(cols.colDigitalAddress))),
        managerName: cleanOptional(cellText(row.getCell(cols.colManager))),
        phone: cleanOptional(cellText(row.getCell(cols.colTel))),
        technicianCode: cleanOptional(cellText(row.getCell(cols.colTechCode))),
        formCode: cleanOptional(cellText(row.getCell(cols.colFormCode))),
        quality,
        // Store Details exists only on legacy sheets; keeping it means no column between
        // A and AP is silently dropped. The archive's own reason wording leads, because
        // eight archive reasons collapse onto five and this is where the distinction
        // between «تقاضای تعویض» and «وضعیت نامساعد» survives.
        notes: cleanOptional(
          [ticked.map((rc) => rc.label).join('، '), feedback, storeDetails]
            .filter(Boolean)
            .join(' | '),
        ),
        outcome,
        notRepairedReason,
        archiveReasonLabel: ticked.map((rc) => rc.label).join('، ') || null,
        parts,
      });
    }

    return { rows, skipped, layout: cols.layout, columnWarnings };
  })();
}

export async function previewHistorical(
  buffer: Buffer,
  format: ArchiveFormat = 'AUTO',
): Promise<HistoricalPreview> {
  const { rows, skipped, layout, columnWarnings } = await readRows(buffer, format);

  const uids = [...new Set(rows.map((r) => r.uid))];
  // Locations, not stands, are what a uid identifies now.
  const existingStores = await prisma.store.findMany({
    where: { uid: { in: uids } },
    select: { uid: true },
  });
  const known = new Set(existingStores.map((s) => s.uid));

  const storeKeys = new Set(
    rows.filter((r) => r.storeName).map((r) => `${r.cityName}::${makeStoreMatchKey(r.storeName!)}`),
  );

  const dates = rows.map((r) => r.date.getTime()).sort((a, b) => a - b);

  // How often each uid appears, so the manager can see repeats rather than guess at
  // them from a count that does not add up.
  const uidCounts = new Map<string, number>();
  for (const row of rows) uidCounts.set(row.uid, (uidCounts.get(row.uid) ?? 0) + 1);

  const reasonCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.outcome !== 'NOT_REPAIRED') continue;
    const label = row.archiveReasonLabel ?? 'نامشخص';
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
  }
  const notRepaired = rows.filter((r) => r.outcome === 'NOT_REPAIRED').length;

  return {
    rows: rows.length,
    forms: rows.length,
    repaired: rows.length - notRepaired,
    notRepaired,
    reasonBreakdown: [...reasonCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    layout,
    columnWarnings,
    distinctUids: uids.length,
    newUids: uids.filter((u) => !known.has(u)).length,
    repeatedUids: [...uidCounts.values()].filter((n) => n > 1).length,
    newStands: uids.filter((u) => !known.has(u)).length,
    newStores: storeKeys.size,
    skipped,
    firstDate: dates.length ? new Date(dates[0]) : null,
    lastDate: dates.length ? new Date(dates[dates.length - 1]) : null,
    sample: rows.slice(0, 8).map((r) => ({
      uid: r.uid,
      date: r.date.toISOString(),
      city: r.cityName,
      parts: r.parts.reduce((s, p) => s + p.quantity, 0),
    })),
  };
}

/**
 * The account historical rows are attributed to. Created on demand and kept out of the
 * technician approval queue so it can't be mistaken for a real person.
 */
async function historicalTechnicianId(): Promise<string> {
  const phone = '00000000000';
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {
      name: 'داده‌های پیش از سامانه',
      phone,
      // No usable password: this account exists only as a foreign key target.
      passwordHash: 'x',
      role: 'TECHNICIAN',
      status: 'REJECTED',
      technicianCode: 'LEGACY',
    },
  });
  return created.id;
}

/**
 * An archive form code that is free, suffixing on collision.
 *
 * `RepairForm.formCode` is unique, but the archives' codes are not: the same paper form
 * number legitimately appears on several rows. Suffixing keeps the original code legible
 * in the data rather than discarding the row.
 */
async function uniqueFormCode(
  tx: Prisma.TransactionClient,
  desired: string,
): Promise<string> {
  const existing = await tx.repairForm.findUnique({ where: { formCode: desired } });
  if (!existing) return desired;

  for (let n = 2; n < 100; n++) {
    const candidate = `${desired}-${n}`;
    const clash = await tx.repairForm.findUnique({ where: { formCode: candidate } });
    if (!clash) return candidate;
  }
  // Beyond that the code is not usable as an identifier; fall back to a fresh sequence.
  return nextFormCode(tx);
}

export async function commitHistorical(
  buffer: Buffer,
  opts: {
    name: string;
    importedById: string;
    /**
     * Campaign the archive belongs to. Without one, an imported archive is invisible to
     * every project filter and only reachable through per-uid history — which is exactly
     * how past uploads went missing from the manager's view.
     */
    projectId?: string | null;
    phaseId?: string | null;
    /** Storage ref of the uploaded original, so the manager can download it again. */
    fileRef?: string | null;
    /** Which reader to use; the manager's explicit choice overrides detection. */
    format?: ArchiveFormat;
  },
) {
  const { rows } = await readRows(buffer, opts.format ?? 'AUTO');
  if (rows.length === 0) return { imported: 0, skipped: 0 };

  const technicianId = await historicalTechnicianId();
  const catalog = await prisma.partCatalogItem.findMany({ orderBy: { sortOrder: 'asc' } });
  const partBySortOrder = new Map(catalog.map((p) => [p.sortOrder, p.id]));

  let imported = 0;
  let skipped = 0;
  /**
   * Why each dropped row was dropped. A bare "skipped: 30" is what let a dedup bug hide
   * in plain sight, so the reason travels back to the manager.
   */
  const skippedRows: Array<{ uid: string; formCode: string | null; reason: string }> = [];

  // Chunked rather than one giant transaction: an archive file can hold thousands of
  // rows, and a single transaction that size risks a statement timeout.
  const CHUNK = 100;

  // One uploaded file is ONE order. Creating a batch per chunk split a single archive
  // into "name (1)", "name (2)"... which is both confusing in the orders list and the
  // reason duplicate uids only sometimes collided: two rows sharing a uid clashed on
  // OrderLine's (batchId, uid) key when they happened to land in the same chunk, and
  // slipped through when they did not.
  const batch = await prisma.importBatch.create({
    data: {
      name: opts.name,
      source: 'HISTORICAL',
      importedById: opts.importedById,
      projectId: opts.projectId ?? null,
      phaseId: opts.phaseId ?? null,
      fileRef: opts.fileRef ?? null,
    },
  });

  // A uid may legitimately appear on several rows — the same location visited twice, or
  // simply entered twice. Each row is still its own repair form, because each is a real
  // visit, but the ORDER LINE is the request for that location and there is exactly one
  // per uid. Tracked across chunks, since the batch now spans the whole file.
  const orderLineUids = new Set<string>();

  // Rows already written by THIS run, so an exact duplicate inside one file is skipped
  // without a database round-trip.
  const seenIdentities = new Set<string>();

  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);

    await prisma.$transaction(
      async (tx) => {

        for (const row of chunk) {
          // Idempotency without losing rows.
          //
          // Form codes in these archives are not unique: a single paper form can cover a
          // store's several stands, and the column is hand-typed. Treating any repeated
          // code as "already imported" silently dropped real visits — a 234-row sheet
          // with 19 repeated codes lost 19 of them.
          //
          // A visit is identified by uid + date + form code instead. That still makes
          // re-importing the same file a no-op, while two genuinely different rows that
          // happen to share a code both survive; the second is stored under a suffixed
          // code, because RepairForm.formCode is unique by schema.
          const identity = `${row.uid}|${row.date.toISOString().slice(0, 10)}|${row.formCode ?? ''}`;

          if (seenIdentities.has(identity)) {
            skipped++;
            skippedRows.push({
              uid: row.uid,
              formCode: row.formCode ?? null,
              reason: 'DUPLICATE_ROW_IN_FILE',
            });
            continue;
          }
          seenIdentities.add(identity);

          if (row.formCode) {
            const sameVisit = await tx.repairForm.findFirst({
              where: {
                uid: row.uid,
                formCode: { startsWith: row.formCode },
                date: {
                  gte: new Date(`${row.date.toISOString().slice(0, 10)}T00:00:00Z`),
                  lt: new Date(
                    new Date(`${row.date.toISOString().slice(0, 10)}T00:00:00Z`).getTime() +
                      DAY_MS,
                  ),
                },
              },
              select: { id: true },
            });
            if (sameVisit) {
              skipped++;
              skippedRows.push({
                uid: row.uid,
                formCode: row.formCode ?? null,
                reason: 'ALREADY_IMPORTED',
              });
              continue;
            }
          }

          // Archives frequently spell cities in English; resolving through the shared
          // matcher keeps them on the same city row as the Persian sheets.
          const cityId = await resolveCityByName(tx, row.cityName);
          const city = { id: cityId! };

          // The uid keys the location, so a historical sheet lands on the same store
          // record a live import would.
          const store = await tx.store.upsert({
            where: { uid: row.uid },
            create: {
              uid: row.uid,
              name: row.storeName || row.uid,
              matchKey: makeStoreMatchKey(row.storeName || row.uid),
              cityId: city.id,
              address: row.address ?? null,
              managerName: row.managerName ?? null,
              phone: row.phone ?? null,
              digitalAddress: row.digitalAddress ?? null,
              confirmation: 'CONFIRMED',
            },
            update: {},
          });
          const storeId = store.id;

          // Archived rows carry no stand position, so they are attributed to stand 1.
          const stand = await tx.stand.upsert({
            where: { storeId_standIndexAtStore: { storeId, standIndexAtStore: 1 } },
            create: { storeId, standIndexAtStore: 1 },
            update: {},
          });

          if (!orderLineUids.has(row.uid)) {
            orderLineUids.add(row.uid);
            await tx.orderLine.create({
              data: {
                batchId: batch.id,
                uid: row.uid,
                storeId,
                storeName: row.storeName,
                address: row.address,
                cityName: row.cityName,
                phone: row.phone,
                managerName: row.managerName,
                status: 'DONE',
              },
            });
          }

          await tx.repairForm.create({
            data: {
              formCode: row.formCode
                ? await uniqueFormCode(tx, row.formCode)
                : await nextFormCode(tx),
              standId: stand.id,
              technicianId,
              cityId: city.id,
              storeId,
              uid: row.uid,
              standIndex: 1,
              // Carried onto the form itself, not just the batch: every project filter
              // in the app reads RepairForm.projectId.
              projectId: opts.projectId ?? null,
              phaseId: opts.phaseId ?? null,
              storeName: row.storeName ?? null,
              storeAddress: row.address ?? null,
              storeManagerName: row.managerName ?? null,
              storePhone: row.phone ?? null,
              digitalAddress: row.digitalAddress ?? null,
              date: row.date,
              qualityScore: row.outcome === 'REPAIRED' ? row.quality : null,
              notes: row.notes ?? null,
              outcome: row.outcome,
              notRepairedReason: row.notRepairedReason,
              // Wages are not reconstructed for pre-system work — the rates in effect
              // then are unknown, and inventing them would corrupt payroll reporting.
              wageAmount: 0,
              wageTier: 1,
              wageRateApplied: 0,
              parts: {
                create: row.parts
                  .filter((p) => partBySortOrder.has(p.sortOrder))
                  .map((p) => ({
                    partCatalogItemId: partBySortOrder.get(p.sortOrder)!,
                    action: 'REPLACED' as const,
                    quantity: p.quantity,
                  })),
              },
            },
          });

          imported++;
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  return { imported, skipped, skippedRows, batchId: batch.id };
}

/**
 * Undo a historical import: remove the batch, its order lines, and the archived forms it
 * created.
 *
 * This exists because the Jti-order delete deliberately refuses once any uid carries a
 * repair report — a report is fieldwork and outranks the order that requested it. For a
 * HISTORICAL import that rule is wrong: those "reports" are spreadsheet rows, and a
 * part-committed import (chunks commit independently, so a mid-file failure leaves
 * earlier rows behind) otherwise strands them with no way back.
 *
 * Only forms written by the archive importer are touched — a technician's real report for
 * the same uid survives, whatever the archive did. Stores and stands go only if nothing
 * else references them.
 */
export async function deleteHistoricalImport(batchId: string) {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, source: true, fileRef: true },
  });
  if (!batch) throw new Error('NOT_FOUND');
  if (batch.source !== 'HISTORICAL') throw new Error('NOT_HISTORICAL');

  const uids = [
    ...new Set(
      (
        await prisma.orderLine.findMany({
          where: { batchId },
          select: { uid: true },
        })
      ).map((l) => l.uid),
    ),
  ];

  const forms = await prisma.repairForm.findMany({
    where: { uid: { in: uids }, technician: { technicianCode: 'LEGACY' } },
    select: { id: true, technicianSignature: true, storeManagerSignature: true },
  });
  const formIds = forms.map((f) => f.id);

  const photos = await prisma.photo.findMany({
    where: { repairFormId: { in: formIds } },
    select: { fileRef: true },
  });

  await prisma.$transaction(
    async (tx) => {
      await tx.partUsage.deleteMany({ where: { repairFormId: { in: formIds } } });
      await tx.photo.deleteMany({ where: { repairFormId: { in: formIds } } });
      await tx.repairForm.deleteMany({ where: { id: { in: formIds } } });
      await tx.orderLine.deleteMany({ where: { batchId } });
      await tx.importBatch.delete({ where: { id: batchId } });

      for (const uid of uids) {
        const stillUsed =
          (await tx.repairForm.count({ where: { uid } })) +
          (await tx.orderLine.count({ where: { uid } }));
        if (stillUsed === 0) {
          await tx.stand.deleteMany({ where: { store: { uid } } });
          await tx.store.deleteMany({ where: { uid } });
        }
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  // Files last, so a rolled-back transaction never leaves dangling references.
  const storage = getStorage();
  const refs = [
    ...photos.map((p) => p.fileRef),
    ...forms.flatMap((f) => [f.technicianSignature, f.storeManagerSignature]),
    batch.fileRef,
  ].filter((r): r is string => !!r);
  await Promise.all(refs.map((ref) => storage.delete(ref).catch(() => {})));

  return { forms: formIds.length, orderLines: uids.length };
}
