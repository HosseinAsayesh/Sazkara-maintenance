import 'server-only';

import ExcelJS from 'exceljs';

import { nextFormCode } from './codes';
import { PART_CATALOG, JTI_EXPORT_HEADERS } from './parts';
import { prisma } from './prisma';
import { cleanOptional, makeStoreMatchKey, normaliseUid, toLatinDigits } from './text';

/**
 * §7 — import previously-completed Jti export files (from before this system existed)
 * so historical work counts toward stats and analytics.
 *
 * Input is the same 43-column layout this app *produces* (§8), which is what the repair
 * manager has archived. Columns are located by position, not by header text, because
 * older files were hand-maintained and their headers drifted; the header row is only
 * used to detect how many rows to skip.
 *
 * Historical rows are recorded as REPAIRED forms with parts marked REPLACED (columns
 * 5–34 are replacement quantities). They carry no photos or signatures — that data never
 * existed on paper — so they are attributed to a dedicated technician account and are
 * excluded from wage totals rather than inventing amounts.
 */

const COL_ROW_NUMBER = 1;
const COL_DATE = 2;
const COL_CITY = 3;
const COL_UID = 4;
const COL_FIRST_PART = 5;
const COL_DIGITAL_ADDRESS = 35;
const COL_ADDRESS = 36;
const COL_MAINTENANCE = 37;
const COL_TEL = 38;
const COL_STORE = 39;
const COL_MANAGER = 40;
const COL_TECH_CODE = 41;
const COL_FORM_CODE = 42;
const COL_QUALITY = 43;

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
  parts: Array<{ sortOrder: number; quantity: number }>;
}

function readRows(buffer: Buffer): Promise<{ rows: HistoricalRow[]; skipped: number }> {
  return (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('NO_SHEET');

    // Detect the header row by looking for the known first header, falling back to row 1.
    let headerRow = 1;
    for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
      const first = cellText(sheet.getRow(r).getCell(COL_ROW_NUMBER)).trim();
      const second = cellText(sheet.getRow(r).getCell(COL_DATE)).trim();
      if (first === JTI_EXPORT_HEADERS[0] || second === JTI_EXPORT_HEADERS[1]) {
        headerRow = r;
        break;
      }
    }

    const rows: HistoricalRow[] = [];
    let skipped = 0;

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const uid = normaliseUid(cellText(row.getCell(COL_UID)));
      const date = parseHistoricalDate(cellText(row.getCell(COL_DATE)));

      if (!uid || !date) {
        if (uid || cellText(row.getCell(COL_DATE))) skipped++;
        continue;
      }

      const parts: Array<{ sortOrder: number; quantity: number }> = [];
      for (const part of PART_CATALOG) {
        const qty = cellNumber(row.getCell(COL_FIRST_PART + part.sortOrder - 1).value);
        if (qty > 0) parts.push({ sortOrder: part.sortOrder, quantity: Math.round(qty) });
      }

      const qualityRaw = cellText(row.getCell(COL_QUALITY));
      const quality = qualityRaw ? Math.max(0, Math.min(5, cellNumber(qualityRaw))) : null;

      rows.push({
        uid,
        date,
        cityName: cellText(row.getCell(COL_CITY)).trim() || 'نامشخص',
        storeName: cleanOptional(cellText(row.getCell(COL_STORE))),
        address: cleanOptional(cellText(row.getCell(COL_ADDRESS))),
        digitalAddress: cleanOptional(cellText(row.getCell(COL_DIGITAL_ADDRESS))),
        managerName: cleanOptional(cellText(row.getCell(COL_MANAGER))),
        phone: cleanOptional(cellText(row.getCell(COL_TEL))),
        technicianCode: cleanOptional(cellText(row.getCell(COL_TECH_CODE))),
        formCode: cleanOptional(cellText(row.getCell(COL_FORM_CODE))),
        quality,
        notes: cleanOptional(cellText(row.getCell(COL_MAINTENANCE))),
        parts,
      });
    }

    return { rows, skipped };
  })();
}

export async function previewHistorical(buffer: Buffer): Promise<HistoricalPreview> {
  const { rows, skipped } = await readRows(buffer);

  const uids = [...new Set(rows.map((r) => r.uid))];
  const existingStands = await prisma.stand.findMany({
    where: { uid: { in: uids } },
    select: { uid: true },
  });
  const known = new Set(existingStands.map((s) => s.uid));

  const storeKeys = new Set(
    rows.filter((r) => r.storeName).map((r) => `${r.cityName}::${makeStoreMatchKey(r.storeName!)}`),
  );

  const dates = rows.map((r) => r.date.getTime()).sort((a, b) => a - b);

  return {
    rows: rows.length,
    forms: rows.length,
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
  opts: { name: string; importedById: string },
) {
  const { rows } = await readRows(buffer);
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

          let city = await tx.city.findFirst({ where: { name: row.cityName } });
          city ??= await tx.city.create({
            data: {
              name: row.cityName,
              isTehran: makeStoreMatchKey(row.cityName) === makeStoreMatchKey('تهران'),
            },
          });

          let storeId: string | null = null;
          if (row.storeName) {
            const matchKey = makeStoreMatchKey(row.storeName);
            const store = await tx.store.upsert({
              where: { cityId_matchKey: { cityId: city.id, matchKey } },
              create: {
                name: row.storeName,
                matchKey,
                cityId: city.id,
                address: row.address ?? null,
                managerName: row.managerName ?? null,
                phone: row.phone ?? null,
                digitalAddress: row.digitalAddress ?? null,
              },
              update: {},
            });
            storeId = store.id;
          }

          let stand = await tx.stand.findUnique({ where: { uid: row.uid } });
          if (!stand) {
            const siblings = storeId ? await tx.stand.count({ where: { storeId } }) : 0;
            stand = await tx.stand.create({
              data: {
                uid: row.uid,
                storeId,
                standIndexAtStore: siblings + 1,
                confirmation: 'CONFIRMED',
              },
            });
          }

          await tx.orderLine.create({
            data: {
              batchId: batch.id,
              uid: row.uid,
              standId: stand.id,
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
              storeName: row.storeName ?? null,
              storeAddress: row.address ?? null,
              storeManagerName: row.managerName ?? null,
              storePhone: row.phone ?? null,
              digitalAddress: row.digitalAddress ?? null,
              date: row.date,
              qualityScore: row.quality,
              notes: row.notes ?? null,
              outcome: 'REPAIRED',
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
