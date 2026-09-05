import 'server-only';

import ExcelJS from 'exceljs';

import { resolveCityId as resolveCityByName } from './cities';
import { nextFormCode } from './codes';
import {
  JTI_EXPORT_HEADERS,
  LEGACY_PART_COLUMN_COUNT,
  LEGACY_TO_CURRENT_SORT_ORDER,
  PART_CATALOG,
} from './parts';
import { prisma } from './prisma';
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

  // No usable header. Width alone is a poor signal — the legacy sheet carries extra
  // status columns after the feedback column, so it is WIDER than a current export and a
  // naive ">= current width" test misreads it as current. Prefer the exact widths, and
  // only then fall back to a range.
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
  rows: number;
  forms: number;
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
  parts: Array<{ sortOrder: number; quantity: number }>;
}

function readRows(
  buffer: Buffer,
  format: ArchiveFormat = 'AUTO',
): Promise<{ rows: HistoricalRow[]; skipped: number; layout: ArchiveLayout }> {
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

    // A legacy sheet spreads its header over two rows: section labels on the first, part
    // names on the second. Data therefore starts one row later than the marker row.
    // Detected rather than assumed, so a single-row variant still imports.
    const partNameRow = sheet.getRow(headerRow + 1);
    const secondRowIsHeader =
      !normaliseUid(cellText(partNameRow.getCell(COL_UID))) &&
      !cellText(partNameRow.getCell(COL_DATE)).trim() &&
      cellText(partNameRow.getCell(COL_FIRST_PART)).trim().length > 0;
    const firstDataRow = headerRow + (secondRowIsHeader ? 2 : 1);

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

      // Column AP carries the technician's final review, e.g. "تعمیرات موفقیت آمیز بود"
      // or "... نبود". It is the only outcome signal an archive has.
      const feedback = cellText(row.getCell(cols.colMaintenance)).trim();
      const storeDetails = cols.colStoreDetails
        ? cellText(row.getCell(cols.colStoreDetails)).trim()
        : '';

      // §6.1 stays intact: parts decide the outcome. The review only settles rows that
      // recorded no parts at all, which is exactly the unsuccessful visits.
      const reviewSaysFailed = /نبود|unsuccessful|not\s*success/i.test(feedback);
      const outcome: 'REPAIRED' | 'NOT_REPAIRED' =
        parts.length > 0 ? 'REPAIRED' : reviewSaysFailed ? 'NOT_REPAIRED' : 'REPAIRED';

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
        // A and AP is silently dropped.
        notes: cleanOptional([feedback, storeDetails].filter(Boolean).join(' | ')),
        outcome,
        parts,
      });
    }

    return { rows, skipped, layout: cols.layout };
  })();
}

export async function previewHistorical(
  buffer: Buffer,
  format: ArchiveFormat = 'AUTO',
): Promise<HistoricalPreview> {
  const { rows, skipped, layout } = await readRows(buffer, format);

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

  return {
    rows: rows.length,
    forms: rows.length,
    layout,
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

  // Chunked rather than one giant transaction: an archive file can hold thousands of
  // rows, and a single transaction that size risks a statement timeout.
  const CHUNK = 100;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);

    await prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: {
            name: `${opts.name} (${start / CHUNK + 1})`,
            source: 'HISTORICAL',
            importedById: opts.importedById,
            projectId: opts.projectId ?? null,
            phaseId: opts.phaseId ?? null,
            fileRef: opts.fileRef ?? null,
          },
        });

        for (const row of chunk) {
          // Skip rows already present, so re-running an archive import is idempotent.
          if (row.formCode) {
            const clash = await tx.repairForm.findUnique({
              where: { formCode: row.formCode },
            });
            if (clash) {
              skipped++;
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

          await tx.repairForm.create({
            data: {
              formCode: row.formCode || (await nextFormCode(tx)),
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

  return { imported, skipped };
}
