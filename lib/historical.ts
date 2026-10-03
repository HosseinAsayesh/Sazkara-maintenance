import 'server-only';

import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

import { resolveCityId as resolveCityByName } from './cities';
import { nextFormCode } from './codes';
import { DAY_MS } from './dates';
import {
  JTI_COL,
  LEGACY_PART_COLUMN_COUNT,
  LEGACY_TO_CURRENT_SORT_ORDER,
  PART_CATALOG,
} from './parts';
import { prisma } from './prisma';
import { NOT_REPAIRED_REASONS, REASON_INFO, type NotRepairedReasonKey } from './reasons';
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
 * The client's Jti sheet is the one Excel format (2026-10): 4 leading columns, 28 part
 * columns, then the trailing block, «Dubble» and the ten reason columns. The app's own
 * export writes the same layout, so anything it exports imports back unchanged.
 */
export type ArchiveLayout = 'LEGACY';

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
  // The client's sheet says «درب»; «پک هواکش» was a brief relabelling, still accepted.
  ['درب', 'پک هواکش'],
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

type NotRepairedReasonValue = NotRepairedReasonKey;

export interface ReasonColumn {
  column: number;
  label: string;
  reason: NotRepairedReasonValue;
}

/**
 * Finds the ten reason columns (44..53 on the client's sheet) by their headers.
 *
 * The match is on a STEM the header contains, not on the whole header. The previous rule
 * demanded an exact match against short labels like «تعطیل», so «تعطیلی فروشگاه»,
 * «وضعیت نامساعد استند» and both «… جمع آوری شده است» columns were never found: a Mashhad
 * file with 27 unsuccessful visits imported as 15, and the other 12 became repairs.
 */
function detectReasonColumns(sheet: ExcelJS.Worksheet, headerRow: number): ReasonColumn[] {
  const found: ReasonColumn[] = [];
  const header = sheet.getRow(headerRow);
  const width = Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0);

  for (let column = 1; column <= width; column++) {
    const text = cellText(header.getCell(column)).trim();
    if (!text) continue;
    const key = makeStoreMatchKey(text);
    const reason = NOT_REPAIRED_REASONS.find((r) =>
      REASON_INFO[r].stems.some((stem) => key.includes(makeStoreMatchKey(stem))),
    );
    if (reason) found.push({ column, label: REASON_INFO[reason].labelFa, reason });
  }

  return found;
}

/**
 * The «Dubble» column: how many MORE stands the row's store had, all serviced on that
 * visit — 1 means two stands, 3 means four. The row's part quantities already cover all
 * of them together («استند1: … - استند2: …» in Store Details). Found by header, falling
 * back to its fixed position on the client's sheet.
 */
function detectDubbleColumn(sheet: ExcelJS.Worksheet, headerRow: number): number | null {
  const header = sheet.getRow(headerRow);
  const width = Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0);
  for (let column = 1; column <= width; column++) {
    const text = cellText(header.getCell(column)).trim().toLowerCase();
    if (text === 'dubble' || text === 'double' || text === 'دابل') return column;
  }
  return null;
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

/**
 * The client's Jti sheet is the only Excel format (2026-10): 28 part columns, then the
 * trailing block. A file whose address column sits after 30 part columns is an export
 * from this app's earlier layout and is refused outright — read at these positions its
 * columns would be shifted by two, silently.
 */
function detectLayout(sheet: ExcelJS.Worksheet, headerRow: number): ResolvedLayout {
  const width = Math.max(sheet.columnCount, sheet.actualColumnCount ?? 0);
  for (const r of [headerRow, headerRow + 1]) {
    const header = sheet.getRow(r);
    for (let c = COL_FIRST_PART; c <= width; c++) {
      if (!isTrailingAddressHeader(cellText(header.getCell(c)))) continue;
      const partCount = c - COL_FIRST_PART;
      if (partCount === LEGACY_PART_COLUMN_COUNT) return legacyLayout();
      throw new Error(`UNSUPPORTED_LAYOUT:${partCount}`);
    }
  }
  return legacyLayout();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    // richText FIRST: a rich-text cell inside a formula result carries both keys, and
    // reading `result` there yields the object rather than the words in the cell.
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
    }
    if (typeof v.text === 'string') return v.text;
    if ('hyperlink' in v) return String(v.hyperlink ?? '');
    if ('error' in v) return '';
    if ('result' in v) {
      const r = v.result;
      // A formula whose result is itself an object (a rich-text or error result) must
      // not be stringified — that is what wrote "[object Object]" into 988 archive rows.
      if (r === null || r === undefined) return '';
      if (typeof r === 'object') return cellText(r as ExcelJS.CellValue);
      return String(r);
    }
    // An unrecognised object shape. Returning nothing is honest; returning
    // "[object Object]" is a value that looks like data and travels to a client's screen.
    return '';
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
  /** Reports that will be created — one per STAND, so more than `rows` when «Dubble» is set. */
  forms: number;
  /** Stands repaired. */
  repaired: number;
  /** Stands added by the «Dubble» column, beyond one per row. */
  extraStands: number;
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
  /** The ticked reason column's header. */
  archiveReasonLabel: string | null;
  /** «Dubble»: further stands at this store on this visit (0 = the row is one stand). */
  extraStands: number;
  parts: Array<{ sortOrder: number; quantity: number }>;
}

/** A part column whose header does not match the catalogue entry it will be filed under. */
export interface ColumnWarning {
  column: number;
  expected: string;
  found: string;
}

function readRows(buffer: Buffer): Promise<{
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
        first === 'رقم' ||
        /^(date|تاریخ)$/i.test(second) ||
        uidHeader ||
        hasEnglishTrailer
      ) {
        headerRow = r;
        break;
      }
    }

    const cols = detectLayout(sheet, headerRow);
    const reasonColumns = detectReasonColumns(sheet, headerRow);
    // Fall back to the sheet's fixed position only when that column is unlabelled: older
    // files without a «Dubble» column put a reason there, and reading a ticked reason as
    // "one more stand" would invent work.
    const dubbleColumn =
      detectDubbleColumn(sheet, headerRow) ??
      (cellText(sheet.getRow(headerRow).getCell(JTI_COL.dubble)).trim() === ''
        ? JTI_COL.dubble
        : null);

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
    const acceptedNames: string[][] = LEGACY_PART_HEADER_ALIASES;

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

      // Extra stands at the same store on this visit; capped well above anything seen
      // (the files hold 1, and a single 3) so a stray number cannot invent a hundred.
      const extraStands =
        dubbleColumn === null
          ? 0
          : Math.max(0, Math.min(9, Math.round(cellNumber(row.getCell(dubbleColumn).value))));

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
        // Store Details carries the per-stand breakdown («استند1: … - استند2: …») on a
        // double-stand row, so it is kept beside the feedback rather than dropped.
        notes: cleanOptional([feedback, storeDetails].filter(Boolean).join(' | ')),
        outcome,
        notRepairedReason,
        archiveReasonLabel: ticked.map((rc) => rc.label).join('، ') || null,
        extraStands,
        parts,
      });
    }

    return { rows, skipped, layout: cols.layout, columnWarnings };
  })();
}

export async function previewHistorical(buffer: Buffer): Promise<HistoricalPreview> {
  const { rows, skipped, layout, columnWarnings } = await readRows(buffer);

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
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1 + row.extraStands);
  }
  // Counted in STANDS, the unit every figure in the app uses: a «Dubble» row is 1 + n.
  const standsOf = (r: HistoricalRow) => 1 + r.extraStands;
  const repaired = rows.filter((r) => r.outcome === 'REPAIRED').reduce((n, r) => n + standsOf(r), 0);
  const notRepaired = rows
    .filter((r) => r.outcome === 'NOT_REPAIRED')
    .reduce((n, r) => n + standsOf(r), 0);

  return {
    rows: rows.length,
    forms: repaired + notRepaired,
    repaired,
    notRepaired,
    extraStands: rows.reduce((n, r) => n + r.extraStands, 0),
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
/** The placeholder account's phone. Payroll excludes it: nobody is paid for archive rows. */
export const HISTORICAL_TECHNICIAN_PHONE = '00000000000';

async function historicalTechnicianId(): Promise<string> {
  const phone = HISTORICAL_TECHNICIAN_PHONE;
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
  },
) {
  const { rows } = await readRows(buffer);
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

          // «Dubble»: the store's further stands, serviced on the same visit. The row's
          // part quantities already cover every stand together and cannot be split, so
          // they stay on stand 1; these reports carry the outcome and the reason, which
          // is what the repaired / not-repaired counts are made of.
          for (let extra = 1; extra <= row.extraStands; extra++) {
            const standIndex = 1 + extra;
            const extraStand = await tx.stand.upsert({
              where: { storeId_standIndexAtStore: { storeId, standIndexAtStore: standIndex } },
              create: { storeId, standIndexAtStore: standIndex },
              update: {},
            });
            await tx.repairForm.create({
              data: {
                formCode: row.formCode
                  ? await uniqueFormCode(tx, `${row.formCode}-${standIndex}`)
                  : await nextFormCode(tx),
                standId: extraStand.id,
                technicianId,
                cityId: city.id,
                storeId,
                uid: row.uid,
                standIndex,
                projectId: opts.projectId ?? null,
                phaseId: opts.phaseId ?? null,
                storeName: row.storeName ?? null,
                storeAddress: row.address ?? null,
                storeManagerName: row.managerName ?? null,
                storePhone: row.phone ?? null,
                digitalAddress: row.digitalAddress ?? null,
                date: row.date,
                qualityScore: row.outcome === 'REPAIRED' ? row.quality : null,
                notes: `استند ${standIndex} همان ردیف (Dubble) — قطعات در گزارش استند ۱ ثبت شده‌اند`,
                outcome: row.outcome,
                notRepairedReason: row.notRepairedReason,
                wageAmount: 0,
                wageTier: 1,
                wageRateApplied: 0,
              },
            });
            imported++;
          }
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
