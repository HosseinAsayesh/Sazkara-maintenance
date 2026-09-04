import 'server-only';

import { createHash } from 'node:crypto';

import ExcelJS from 'exceljs';

import { prisma } from './prisma';
import { cleanOptional, makeStoreMatchKey, normaliseUid } from './text';

/**
 * Jti order import (§5).
 *
 * Jti's column layout is not fixed, so parsing is split in two: `parseWorkbook` reads
 * whatever is in the file and reports the headers it found, and the manager then maps
 * those headers onto system fields. The mapping is hashed against the header row so a
 * similarly-shaped file next time can reuse the saved profile.
 */

export const IMPORT_FIELDS = [
  'uid',
  'storeName',
  'address',
  'digitalAddress',
  'managerName',
  'phone',
  'cityName',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** header index (0-based) -> system field. Anything unmapped is ignored. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export interface ParsedSheet {
  name: string;
  headers: string[];
  /** First few data rows, for the mapping preview. */
  sample: string[][];
  rowCount: number;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  /** Stable hash of the chosen sheet's header row. */
  signature: string;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // ExcelJS's CellValue union covers formulas, rich text and hyperlinks; each carries
    // the display text under a different key, so probe rather than narrow.
    const v = value as unknown as Record<string, unknown>;
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return String(v.result ?? '');
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
    }
    if ('hyperlink' in v) return String(v.hyperlink ?? '');
  }
  return String(value).trim();
}

export function headerSignature(headers: string[]): string {
  return createHash('sha1')
    .update(headers.map((h) => h.trim().toLowerCase()).join('|'))
    .digest('hex');
}

export async function parseWorkbook(
  buffer: Buffer,
  headerRow = 1,
): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: ParsedSheet[] = [];

  workbook.eachSheet((sheet) => {
    const headerCells = sheet.getRow(headerRow);
    const headers: string[] = [];
    headerCells.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value) || `ستون ${col}`;
    });
    for (let i = 0; i < headers.length; i++) headers[i] ??= `ستون ${i + 1}`;

    const sample: string[][] = [];
    const lastRow = sheet.rowCount;
    for (let r = headerRow + 1; r <= Math.min(lastRow, headerRow + 5); r++) {
      const row = sheet.getRow(r);
      const values: string[] = [];
      for (let c = 1; c <= headers.length; c++) values.push(cellText(row.getCell(c).value));
      if (values.some((v) => v !== '')) sample.push(values);
    }

    sheets.push({
      name: sheet.name,
      headers,
      sample,
      rowCount: Math.max(0, lastRow - headerRow),
    });
  });

  return {
    sheets,
    signature: headerSignature(sheets[0]?.headers ?? []),
  };
}

export interface ImportRow {
  rowNumber: number;
  uid: string;
  storeName?: string;
  address?: string;
  digitalAddress?: string;
  managerName?: string;
  phone?: string;
  cityName?: string;
}

export function extractRows(
  buffer: Buffer,
  opts: { sheetName: string; headerRow: number; mapping: ColumnMapping },
): Promise<{ rows: ImportRow[]; skippedNoUid: number }> {
  return (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(opts.sheetName) ?? workbook.worksheets[0];
    if (!sheet) throw new Error('NO_SHEET');

    const rows: ImportRow[] = [];
    let skippedNoUid = 0;

    const read = (row: ExcelJS.Row, field: ImportField): string | undefined => {
      const idx = opts.mapping[field];
      if (idx === undefined) return undefined;
      return cleanOptional(cellText(row.getCell(idx + 1).value));
    };

    for (let r = opts.headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rawUid = read(row, 'uid');
      const uid = rawUid ? normaliseUid(rawUid) : '';

      if (!uid) {
        // Only count rows that had *something* in them — trailing blank rows are noise.
        const anyValue = IMPORT_FIELDS.some((f) => read(row, f));
        if (anyValue) skippedNoUid++;
        continue;
      }

      rows.push({
        rowNumber: r,
        uid,
        storeName: read(row, 'storeName'),
        address: read(row, 'address'),
        digitalAddress: read(row, 'digitalAddress'),
        managerName: read(row, 'managerName'),
        phone: read(row, 'phone'),
        cityName: read(row, 'cityName'),
      });
    }

    return { rows, skippedNoUid };
  })();
}

export interface DuplicateInfo {
  uid: string;
  lastRepairedAt: Date;
  cityName: string | null;
  formCode: string;
  formId: string;
}

/**
 * §6.4 — cross-check incoming uids against every stand ever serviced, in any batch and
 * any year. Jti re-sends codes that don't actually need work, so these are surfaced for
 * the manager to decide on; nothing is dropped or admitted silently.
 */
export async function findPreviouslyRepaired(uids: string[]): Promise<Map<string, DuplicateInfo>> {
  if (uids.length === 0) return new Map();

  const forms = await prisma.repairForm.findMany({
    where: { outcome: 'REPAIRED', stand: { uid: { in: uids } } },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      formCode: true,
      date: true,
      city: { select: { name: true } },
      stand: { select: { uid: true } },
    },
  });

  const out = new Map<string, DuplicateInfo>();
  for (const form of forms) {
    // findMany is ordered newest-first, so the first hit per uid is the latest repair.
    if (out.has(form.stand.uid)) continue;
    out.set(form.stand.uid, {
      uid: form.stand.uid,
      lastRepairedAt: form.date,
      cityName: form.city?.name ?? null,
      formCode: form.formCode,
      formId: form.id,
    });
  }
  return out;
}

export interface ReviewResult {
  rows: ImportRow[];
  skippedNoUid: number;
  /** uids appearing more than once inside the uploaded file itself. */
  duplicatesInFile: string[];
  /** uid -> where it was serviced before. */
  previouslyRepaired: Record<string, DuplicateInfo>;
}

export async function buildReview(
  rows: ImportRow[],
  skippedNoUid: number,
): Promise<ReviewResult> {
  const seen = new Set<string>();
  const duplicatesInFile = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.uid)) duplicatesInFile.add(row.uid);
    seen.add(row.uid);
  }

  const previously = await findPreviouslyRepaired([...seen]);

  return {
    rows,
    skippedNoUid,
    duplicatesInFile: [...duplicatesInFile],
    previouslyRepaired: Object.fromEntries(previously),
  };
}

export interface CommitOptions {
  name: string;
  source: 'JTI_EXCEL' | 'MANUAL' | 'HISTORICAL';
  importedById: string;
  fileRef?: string;
  mapping?: ColumnMapping;
  mappingProfileId?: string;
  /** uids the manager chose to leave out (§6.4). Stored as EXCLUDED, never deleted. */
  excludedUids?: string[];
  /** §6.2 — manual stray uids are admitted straight away when a manager adds them. */
  confirmStands?: boolean;
  /** Campaign this order belongs to. Defaults to the active project. */
  projectId?: string | null;
  phaseId?: string | null;
}

/**
 * Write the reviewed rows into a batch. Stores/stands are created as needed; existing
 * stands are reused so history follows the uid rather than the batch.
 */
export async function commitImport(rows: ImportRow[], opts: CommitOptions) {
  const excluded = new Set((opts.excludedUids ?? []).map(normaliseUid));

  // An order belongs to a campaign. Unless the manager picked one, it joins the active
  // project — otherwise the rows would sit outside every project filter and the stands
  // repaired against them would have no campaign to be a re-repair *within*.
  let projectId = opts.projectId ?? null;
  let phaseId = opts.phaseId ?? null;
  if (!projectId) {
    const active = await prisma.project.findFirst({
      where: { isActive: true },
      select: { id: true, phases: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    projectId = active?.id ?? null;
    phaseId = phaseId ?? active?.phases[0]?.id ?? null;
  }

  // Collapse in-file duplicates: last row for a uid wins, since later rows in Jti's
  // sheets tend to be the corrected ones.
  const byUid = new Map<string, ImportRow>();
  for (const row of rows) byUid.set(row.uid, row);
  const unique = [...byUid.values()];

  const duplicateInfo = await findPreviouslyRepaired(unique.map((r) => r.uid));

  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          name: opts.name,
          source: opts.source,
          importedById: opts.importedById,
          fileRef: opts.fileRef,
          columnMapping: opts.mapping ? (opts.mapping as object) : undefined,
          mappingProfileId: opts.mappingProfileId,
          projectId,
          phaseId,
        },
      });

      // City + store caches keep this to a handful of queries on a 2000-row sheet.
      const cityCache = new Map<string, string>();
      const storeCache = new Map<string, string>();

      let created = 0;
      let excludedCount = 0;

      for (const row of unique) {
        const isExcluded = excluded.has(row.uid);
        if (isExcluded) excludedCount++;
        else created++;

        // --- City ---
        let cityId: string | null = null;
        if (row.cityName) {
          const key = makeStoreMatchKey(row.cityName);
          if (cityCache.has(key)) {
            cityId = cityCache.get(key)!;
          } else {
            const existing = await tx.city.findFirst({ where: { name: row.cityName } });
            const city =
              existing ??
              (await tx.city.create({
                data: {
                  name: row.cityName,
                  isTehran: key === makeStoreMatchKey('تهران'),
                },
              }));
            cityId = city.id;
            cityCache.set(key, city.id);
          }
        }

        // --- Store ---
        let storeId: string | null = null;
        if (row.storeName && cityId) {
          const matchKey = makeStoreMatchKey(row.storeName);
          const cacheKey = `${cityId}:${matchKey}`;
          if (storeCache.has(cacheKey)) {
            storeId = storeCache.get(cacheKey)!;
          } else {
            const store = await tx.store.upsert({
              where: { cityId_matchKey: { cityId, matchKey } },
              create: {
                name: row.storeName,
                matchKey,
                cityId,
                address: row.address ?? null,
                managerName: row.managerName ?? null,
                phone: row.phone ?? null,
                digitalAddress: row.digitalAddress ?? null,
              },
              // Fill gaps from the new sheet without clobbering better existing data.
              update: {
                address: row.address ?? undefined,
                managerName: row.managerName ?? undefined,
                phone: row.phone ?? undefined,
                digitalAddress: row.digitalAddress ?? undefined,
              },
            });
            storeId = store.id;
            storeCache.set(cacheKey, store.id);
          }
        }

        // --- Stand (created once, ever, per uid) ---
        const existingStand = await tx.stand.findUnique({ where: { uid: row.uid } });
        let standId: string;
        if (existingStand) {
          standId = existingStand.id;
          if (!existingStand.storeId && storeId) {
            const siblings = await tx.stand.count({ where: { storeId } });
            await tx.stand.update({
              where: { id: standId },
              data: { storeId, standIndexAtStore: siblings + 1 },
            });
          }
          // Appearing in an official order confirms a previously-pending stand (§6.2).
          if (existingStand.confirmation === 'PENDING' && opts.source !== 'MANUAL') {
            await tx.stand.update({
              where: { id: standId },
              data: { confirmation: 'CONFIRMED' },
            });
          }
        } else {
          const siblings = storeId ? await tx.stand.count({ where: { storeId } }) : 0;
          const stand = await tx.stand.create({
            data: {
              uid: row.uid,
              storeId,
              standIndexAtStore: siblings + 1,
              confirmation:
                opts.source === 'MANUAL' && !opts.confirmStands ? 'PENDING' : 'CONFIRMED',
              createdById: opts.importedById,
            },
          });
          standId = stand.id;
        }

        const dup = duplicateInfo.get(row.uid);

        await tx.orderLine.create({
          data: {
            batchId: batch.id,
            uid: row.uid,
            standId,
            storeName: row.storeName,
            address: row.address,
            digitalAddress: row.digitalAddress,
            managerName: row.managerName,
            phone: row.phone,
            cityName: row.cityName,
            status: isExcluded ? 'EXCLUDED' : 'PENDING',
            isDuplicate: !!dup,
            duplicateNote: dup
              ? `${dup.formCode} — ${dup.lastRepairedAt.toISOString()}${
                  dup.cityName ? ` — ${dup.cityName}` : ''
                }`
              : null,
            duplicateOfFormId: dup?.formId ?? null,
          },
        });
      }

      return { batch, total: unique.length, created, excluded: excludedCount };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

/** Parse the free-text box managers paste stray uids into (§5). */
export function parseManualUids(text: string): string[] {
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;،\n\r\t]+/)) {
    const uid = normaliseUid(token);
    if (uid) seen.add(uid);
  }
  return [...seen];
}
