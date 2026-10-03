import 'server-only';

import ExcelJS from 'exceljs';

import { formatJalali } from '../dates';
import {
  CATALOG_TO_JTI_PART,
  JTI_COL,
  JTI_FIRST_PART_COLUMN,
  JTI_PART_COUNT,
  JTI_PART_HEADERS_FA,
  JTI_SHEET_COLUMN_COUNT,
  JTI_SHEET_HEADER_ROW,
  REPAIR_LABEL_BY_CANONICAL_FA,
} from '../parts';
import { prisma } from '../prisma';
import { projectScopeWhere } from '../projects';
import {
  NOT_REPAIRED_REASONS,
  REASON_INFO,
  isNotRepairedReason,
  type NotRepairedReasonKey,
} from '../reasons';

/**
 * The Jti export — the client's own sheet, column for column (2026-10). It is the one
 * Excel format of the system: this writes it, lib/historical.ts reads it back.
 *
 *   1            row number
 *   2  Date      Jalali date
 *   3  City
 *   4  UID No.
 *   5..32        the 28 parts («Problem Type»), quantity REPLACED; blank when none
 *   33..42       location address, address, Store Details, Tel, store name, store
 *                manager, technician code, form code, stand quality, feedback
 *   43 Dubble    how many MORE stands of this store the row covers
 *   44..53       the ten not-repaired reasons, 1 in the one that applies
 *
 * Rows, as in the client's files:
 *  - One row per store VISIT for repaired stands: every stand repaired at a uid on one
 *    day by one technician shares a row, its parts summed, «Dubble» = stands − 1, and
 *    Store Details spelling each stand out («استند1: … - استند2: …»).
 *  - One row per unrepaired stand, its reason ticked. So repaired stands = repaired rows
 *    + their Dubble, and unrepaired stands = rows with a tick — the same two numbers the
 *    importer and the dashboard count.
 *  - The technician picks the precise part; the sheet's older columns merge two pairs:
 *    both wire gauges are «سیم نمره1», both switches «کلید» (CATALOG_TO_JTI_PART).
 *  - Within-project re-repairs go to their own workbook (`scope`), so the main sheet
 *    stays one row per stand visit.
 */

/** Which half of the split a workbook covers. */
export type JtiExportScope = 'MAIN' | 'RE_REPAIR' | 'ALL';

export interface JtiExportFilters {
  from?: Date;
  to?: Date;
  cityId?: string;
  projectId?: string | null;
  phaseId?: string | null;
  /**
   * MAIN      — everything in the range except within-project re-repairs.
   * RE_REPAIR — only the within-project re-repairs.
   * ALL       — both, for a manager who wants one combined sheet.
   */
  scope?: JtiExportScope;
}

export interface JtiExportRow {
  date: Date;
  cityName: string;
  cityId: string | null;
  uid: string;
  /** Quantity replaced per Jti part column, index 0 = column 5. */
  parts: number[];
  digitalAddress: string;
  address: string;
  storeDetails: string;
  tel: string;
  storeName: string;
  managerName: string;
  technicianCode: string;
  formCode: string;
  quality: number | null;
  feedback: string;
  /** «Dubble»: further stands this row covers. */
  extraStands: number;
  /** Set on an unrepaired stand's row. */
  reason: NotRepairedReasonKey | null;
  isReRepair: boolean;
  hasPreviousProjectHistory: boolean;
}

const REPAIRED_FEEDBACK = 'تعمیرات موفقیت آمیز بود';

type FormWithParts = Awaited<ReturnType<typeof loadForms>>[number];

async function loadForms(filters: JtiExportFilters) {
  return prisma.repairForm.findMany({
    where: {
      ...(filters.scope === 'RE_REPAIR' ? { outcome: 'REPAIRED' as const } : {}),
      ...(filters.scope === 'RE_REPAIR'
        ? { isReRepair: true }
        : filters.scope === 'ALL'
          ? {}
          : { isReRepair: false }),
      ...projectScopeWhere(filters.projectId, filters.phaseId),
      ...(filters.cityId ? { cityId: filters.cityId } : {}),
      ...(filters.from || filters.to
        ? {
            date: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lt: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: 'asc' }, { formCode: 'asc' }],
    include: {
      city: { select: { id: true, name: true } },
      technician: { select: { technicianCode: true } },
      parts: { include: { part: { select: { nameFa: true, sortOrder: true, unit: true } } } },
    },
  });
}

/** What was done to one stand, in the wording of the client's Store Details column. */
function describeStand(form: FormWithParts): string {
  const qty = (q: number, unit: string) => (unit === 'CENTIMETER' ? `${q} سانتیمتر` : `${q} عدد`);
  const replaced = form.parts
    .filter((p) => p.action === 'REPLACED')
    .map((p) => `تعویض ${qty(p.quantity, p.part.unit)} ${p.part.nameFa}`);
  // A repaired part is stored against a canonical catalogue row, but several rows share
  // one button in the technician's picker — print the button's label, which is what was
  // actually chosen.
  const repaired = form.parts
    .filter((p) => p.action === 'REPAIRED')
    .map(
      (p) =>
        `اصلاح ${qty(p.quantity, p.part.unit)} ${REPAIR_LABEL_BY_CANONICAL_FA.get(p.part.nameFa) ?? p.part.nameFa}`,
    );
  const work = [...replaced, ...repaired].join(' + ');
  const notes = form.notes?.trim();
  return [work, notes].filter(Boolean).join(' | ');
}

function dayKey(date: Date): string {
  return formatJalali(date);
}

export async function collectJtiRows(filters: JtiExportFilters): Promise<JtiExportRow[]> {
  const forms = await loadForms(filters);

  // Repaired stands of one visit share a row; each unrepaired stand stands alone.
  const groups: FormWithParts[][] = [];
  const visitIndex = new Map<string, number>();
  for (const form of forms) {
    if (form.outcome !== 'REPAIRED') {
      groups.push([form]);
      continue;
    }
    const key = `${form.uid}|${dayKey(form.date)}|${form.technicianId}|${form.isReRepair}`;
    const at = visitIndex.get(key);
    if (at === undefined) {
      visitIndex.set(key, groups.length);
      groups.push([form]);
    } else {
      groups[at].push(form);
    }
  }

  return groups.map((stands) => {
    stands.sort((a, b) => a.standIndex - b.standIndex);
    const first = stands[0];

    const parts = Array.from({ length: JTI_PART_COUNT }, () => 0);
    for (const stand of stands) {
      for (const usage of stand.parts) {
        if (usage.action !== 'REPLACED') continue;
        const column = CATALOG_TO_JTI_PART[usage.part.sortOrder];
        if (column) parts[column - 1] += usage.quantity;
      }
    }

    const reason =
      first.outcome === 'NOT_REPAIRED' && isNotRepairedReason(first.notRepairedReason)
        ? first.notRepairedReason
        : null;

    const storeDetails =
      first.outcome === 'NOT_REPAIRED'
        ? [reason ? REASON_INFO[reason].labelFa : '', first.notes?.trim()]
            .filter(Boolean)
            .join(' | ')
        : stands.length === 1
          ? describeStand(first)
          : stands.map((s, i) => `استند${i + 1}: ${describeStand(s)}`).join(' - ');

    const qualities = stands
      .map((s) => s.qualityScore)
      .filter((q): q is number => q !== null);

    return {
      date: first.date,
      cityName: first.city?.name ?? '',
      cityId: first.cityId,
      uid: first.uid,
      parts,
      digitalAddress: first.digitalAddress ?? '',
      address: first.storeAddress ?? '',
      storeDetails,
      tel: first.storePhone ?? '',
      storeName: first.storeName ?? '',
      managerName: first.storeManagerName ?? '',
      technicianCode: first.technician.technicianCode ?? '',
      formCode: first.formCode,
      // One score per row on the sheet; a visit is as good as its weakest stand.
      quality: qualities.length ? Math.min(...qualities) : null,
      feedback:
        first.outcome === 'REPAIRED'
          ? REPAIRED_FEEDBACK
          : reason
            ? REASON_INFO[reason].feedbackFa
            : 'تعمیر انجام نشد',
      extraStands: stands.length - 1,
      reason,
      isReRepair: first.isReRepair,
      hasPreviousProjectHistory: stands.some((s) => s.hasPreviousProjectHistory),
    };
  });
}

const THIN = { style: 'thin' } as const;
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const TINT = {
  notRepaired: 'FFFCE4E4',
  double: 'FFDDEBF7',
  history: 'FFFFF6E0',
} as const;

export async function buildJtiWorkbook(
  rows: JtiExportRow[],
  scope: JtiExportScope = 'MAIN',
  sheetName?: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(
    (sheetName || (scope === 'RE_REPAIR' ? 'تعمیرات مجدد' : 'گزارش')).slice(0, 31),
    // As the client's sheet: the four identifying columns and two header rows frozen.
    { views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }] },
  );

  // Row 1: section headers; row 2: the part names under «Problem Type».
  const header = sheet.addRow(JTI_SHEET_HEADER_ROW);
  const partNames = sheet.addRow([
    '', '', '', '',
    ...JTI_PART_HEADERS_FA,
    ...Array.from({ length: JTI_SHEET_COLUMN_COUNT - JTI_FIRST_PART_COLUMN + 1 - JTI_PART_COUNT }, () => ''),
  ]);
  for (const [row, argb] of [[header, 'FFA5A5A5'], [partNames, 'FFC6EFCE']] as const) {
    row.font = { bold: true, size: 10 };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    for (let c = 1; c <= JTI_SHEET_COLUMN_COUNT; c++) {
      const cell = row.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      cell.border = BORDER;
    }
  }
  header.height = 30;
  partNames.height = 42;

  rows.forEach((row, i) => {
    const reasonCells = NOT_REPAIRED_REASONS.map((r) => (r === row.reason ? 1 : ''));
    const added = sheet.addRow([
      i + 1,
      formatJalali(row.date),
      row.cityName,
      row.uid,
      ...row.parts.map((q) => (q > 0 ? q : '')),
      row.digitalAddress,
      row.address,
      row.storeDetails,
      row.tel,
      row.storeName,
      row.managerName,
      row.technicianCode,
      row.formCode,
      row.quality ?? '',
      row.feedback,
      row.extraStands > 0 ? row.extraStands : '',
      ...reasonCells,
    ]);

    // A marker is a row tint, never an extra column, so the sheet keeps its shape. Most
    // consequential first: not repaired, then several stands, then earlier history.
    const tint = row.reason
      ? TINT.notRepaired
      : row.extraStands > 0
        ? TINT.double
        : row.hasPreviousProjectHistory
          ? TINT.history
          : null;
    for (let c = 1; c <= JTI_SHEET_COLUMN_COUNT; c++) {
      const cell = added.getCell(c);
      cell.border = BORDER;
      if (tint) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
    }
  });

  const widths: Record<number, number> = {
    1: 7, 2: 12, 3: 10, 4: 16,
    [JTI_COL.digitalAddress]: 34, [JTI_COL.address]: 40, [JTI_COL.storeDetails]: 50,
    [JTI_COL.tel]: 14, [JTI_COL.store]: 24, [JTI_COL.manager]: 20, [JTI_COL.techCode]: 12,
    [JTI_COL.formCode]: 13, [JTI_COL.quality]: 9, [JTI_COL.feedback]: 34, [JTI_COL.dubble]: 8,
  };
  for (let c = 1; c <= JTI_SHEET_COLUMN_COUNT; c++) {
    const isPart = c >= JTI_FIRST_PART_COLUMN && c < JTI_FIRST_PART_COLUMN + JTI_PART_COUNT;
    sheet.getColumn(c).width = widths[c] ?? (isPart ? 9 : 11);
  }
  for (const c of [1, 2, JTI_COL.quality, JTI_COL.dubble]) {
    sheet.getColumn(c).alignment = { horizontal: 'center' };
  }
  sheet.getColumn(JTI_COL.storeDetails).alignment = { wrapText: true, vertical: 'top' };
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: JTI_SHEET_COLUMN_COUNT } };

  // Colour does not explain itself once the file leaves the app, so a short legend.
  const legend = workbook.addWorksheet('راهنما', { views: [{ rightToLeft: true }] });
  legend.getColumn(1).width = 12;
  legend.getColumn(2).width = 70;
  legend.addRow(['رنگ', 'معنی']).font = { bold: true };
  for (const [argb, meaning] of [
    [TINT.notRepaired, 'تعمیر انجام نشد — دلیل با عدد ۱ در یکی از ستون‌های پایانی مشخص است'],
    [TINT.double, 'چند استند در یک فروشگاه — تعداد استندهای اضافه در ستون Dubble'],
    [TINT.history, 'این شناسه در پروژه‌های قبلی هم تعمیر شده است'],
  ] as Array<[string, string]>) {
    const row = legend.addRow(['', meaning]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    row.getCell(1).border = BORDER;
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

export interface CityBundle {
  cityName: string;
  filename: string;
  buffer: Buffer;
  rowCount: number;
}

/**
 * Human label for the exported range, used in file names. An open-ended range reads as
 * "from <date>" / "up to <date>" rather than leaving an ellipsis in the file name.
 */
export function rangeLabel(from?: string | null, to?: string | null): string {
  const fmt = (iso: string) => formatJalali(new Date(`${iso}T12:00:00Z`)).replace(/\//g, '.');
  if (from && to) return `${fmt(from)} - ${fmt(to)}`;
  if (from) return `از ${fmt(from)}`;
  if (to) return `تا ${fmt(to)}`;
  return 'همه تاریخ‌ها';
}

/** Windows/Excel-safe file name. */
export function safeFilename(input: string): string {
  return (
    input
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'export'
  );
}

/** One workbook per city — the shape Jti receives (§8), each sheet named after its city. */
export async function buildJtiWorkbooksPerCity(
  rows: JtiExportRow[],
  labelForRange: string,
  scope: JtiExportScope = 'MAIN',
): Promise<CityBundle[]> {
  const byCity = new Map<string, JtiExportRow[]>();
  for (const row of rows) {
    const key = row.cityName || 'نامشخص';
    const list = byCity.get(key);
    if (list) list.push(row);
    else byCity.set(key, [row]);
  }

  const bundles: CityBundle[] = [];
  for (const [cityName, cityRows] of byCity) {
    const suffix = scope === 'RE_REPAIR' ? ' - تعمیرات مجدد' : '';
    bundles.push({
      cityName,
      filename: `${safeFilename(cityName)} - ${labelForRange}${suffix}.xlsx`,
      buffer: await buildJtiWorkbook(cityRows, scope, cityName),
      rowCount: cityRows.length,
    });
  }
  return bundles.sort((a, b) => a.cityName.localeCompare(b.cityName, 'fa'));
}
