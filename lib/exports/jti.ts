import 'server-only';

import ExcelJS from 'exceljs';

import { formatJalali } from '../dates';
import { JTI_EXPORT_COLUMN_COUNT, JTI_EXPORT_HEADERS, PART_CATALOG } from '../parts';
import { prisma } from '../prisma';
import { projectScopeWhere } from '../projects';

/**
 * The Jti export (§8) — 43 columns, in this exact order, with the Persian headers
 * verbatim regardless of UI locale.
 *
 * Layout:
 *   1  رقم              row number
 *   2  تاریخ             repair date (Jalali — confirmed with the client)
 *   3  شهر               city
 *   4  شناسه             stand uid
 *   5..34                the 30 parts, each holding the QUANTITY REPLACED (0 if none)
 *   35..43               digital address, address, maintenance detail, tel, store name,
 *                        manager's name, technician code, form code, stand quality
 *   44                   repair status in words, with the reason when it failed
 *
 * Stated assumptions (see README §"Export assumptions"):
 *  - Only REPAIRED visits produce rows — the spec says "one row per repaired stand", and
 *    an unsuccessful visit has no parts and no quality score to report.
 *  - Columns 5–34 count REPLACED parts only. Parts repaired in place are not consumed
 *    inventory (§6.8); they are described in column 37 instead so the information is not
 *    lost.
 *  - Rows are per STAND, not per uid. A store with three stands produces three rows all
 *    carrying the same شناسه, because the parts and quality are per-stand facts. Those
 *    rows are tinted BLUE so Jti can see at a glance they are one location's double
 *    stands rather than duplicated records.
 *  - Unsuccessful visits DO appear, tinted RED (client ruling). They carry zeroes in the
 *    part columns, no quality score, and the reason in column 37, so Jti sees the whole
 *    visit list rather than only completed work.
 *  - Tint precedence, most severe first: red (not repaired) > blue (double stand) >
 *    cream (repaired in an earlier project). A row can qualify for several.
 *  - Scope (client ruling, revised §6.3). Every stand repaired during the project goes
 *    into the MAIN workbook, including stands that were already repaired in earlier
 *    projects — a uid recurring across campaigns is normal work, not a duplicate. Only
 *    a stand repaired twice INSIDE the same project is a re-repair, and those rows are
 *    split out into their own workbook so Jti's main sheet stays one-row-per-stand.
 *    `scope` selects which of the two you get.
 *  - Quantities in columns 5-34 are in the part's own unit: pieces for everything except
 *    the two SMD strips, which are recorded in centimetres (50, 100, 150, ...).
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
   * MAIN      — everything repaired in the range except within-project re-repairs.
   * RE_REPAIR — only the within-project re-repairs.
   * ALL       — both, for a manager who wants one combined sheet.
   */
  scope?: JtiExportScope;
}

export interface JtiExportRow {
  cityName: string;
  cityId: string | null;
  date: Date;
  uid: string;
  /** exportColumnKey -> quantity replaced */
  replaced: Record<string, number>;
  digitalAddress: string;
  address: string;
  maintenanceDetail: string;
  tel: string;
  storeName: string;
  managerName: string;
  technicianCode: string;
  formCode: string;
  standQuality: number | null;
  /** Column 44 — "تعمیر شد", or "تعمیر نشد — <reason>". */
  repairStatus: string;
  /** Repaired in an earlier campaign. Marked in the sheet, but still a main-export row. */
  hasPreviousProjectHistory: boolean;
  isReRepair: boolean;
  /** The visit produced no repair — row is tinted red. */
  notRepaired: boolean;
  /** This location had more than one stand serviced — rows tinted blue. */
  isDoubleStand: boolean;
  /** 1-based position of this stand at its location. */
  standIndex: number;
}

/**
 * Column 37. Free text, so it is built to stay readable in the Persian sheet while
 * keeping the replaced/repaired distinction that columns 5–34 cannot express.
 */
const NOT_REPAIRED_LABELS_FA: Record<string, string> = {
  MANAGER_NOT_AUTHORIZED: 'مدیر فروشگاه اجازه‌ی تعمیر نداد',
  STORE_OR_STAND_REMOVED: 'فروشگاه یا استند جمع‌آوری شده بود',
  ALREADY_HEALTHY: 'استند سالم بود و نیاز به تعمیر نداشت',
  STORE_TEMPORARILY_CLOSED: 'فروشگاه موقتاً تعطیل بود',
  CONDITION_TOO_POOR: 'وضعیت استند برای تعمیر بسیار نامناسب بود',
};

function buildMaintenanceDetail(
  parts: Array<{ action: string; quantity: number; part: { nameFa: string } }>,
  notes: string | null,
): string {
  const replaced = parts.filter((p) => p.action === 'REPLACED');
  const repaired = parts.filter((p) => p.action === 'REPAIRED');

  const segments: string[] = [];
  if (replaced.length) {
    segments.push(
      `تعویض: ${replaced.map((p) => `${p.part.nameFa} (${p.quantity})`).join('، ')}`,
    );
  }
  if (repaired.length) {
    segments.push(
      `تعمیر: ${repaired.map((p) => `${p.part.nameFa} (${p.quantity})`).join('، ')}`,
    );
  }
  if (notes?.trim()) segments.push(`توضیحات: ${notes.trim()}`);

  return segments.join(' | ');
}

export async function collectJtiRows(filters: JtiExportFilters): Promise<JtiExportRow[]> {
  const forms = await prisma.repairForm.findMany({
    where: {
      // Unsuccessful visits are included so Jti sees the full visit list; they are
      // tinted red in the sheet. Re-repair scoping only applies to actual repairs.
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
      technician: { select: { technicianCode: true, name: true } },
      parts: { include: { part: { select: { nameFa: true, exportColumnKey: true } } } },
    },
  });

  // A location whose visit covered more than one stand: those rows get the blue tint.
  // Counted per (uid, day) so a genuine return trip months later is not mislabelled.
  const standsPerVisit = new Map<string, Set<number>>();
  for (const form of forms) {
    const key = `${form.uid}|${form.date.toISOString().slice(0, 10)}`;
    const set = standsPerVisit.get(key) ?? new Set<number>();
    set.add(form.standIndex);
    standsPerVisit.set(key, set);
  }

  return forms.map((form) => {
    const replaced: Record<string, number> = {};
    for (const part of PART_CATALOG) replaced[part.exportColumnKey] = 0;
    for (const usage of form.parts) {
      if (usage.action !== 'REPLACED') continue;
      replaced[usage.part.exportColumnKey] =
        (replaced[usage.part.exportColumnKey] ?? 0) + usage.quantity;
    }

    return {
      cityName: form.city?.name ?? '',
      cityId: form.cityId,
      date: form.date,
      uid: form.uid,
      replaced,
      digitalAddress: form.digitalAddress ?? '',
      address: form.storeAddress ?? '',
      // An unsuccessful visit has no parts to describe, so column 37 carries the fixed
      // reason instead — otherwise the red row would arrive at Jti with no explanation.
      maintenanceDetail:
        form.outcome === 'NOT_REPAIRED'
          ? [
              form.notRepairedReason
                ? NOT_REPAIRED_LABELS_FA[form.notRepairedReason] ?? form.notRepairedReason
                : 'تعمیر انجام نشد',
              form.notes?.trim() ? `توضیحات: ${form.notes.trim()}` : '',
            ]
              .filter(Boolean)
              .join(' | ')
          : buildMaintenanceDetail(form.parts, form.notes),
      tel: form.storePhone ?? '',
      storeName: form.storeName ?? '',
      managerName: form.storeManagerName ?? '',
      technicianCode: form.technician.technicianCode ?? '',
      formCode: form.formCode,
      standQuality: form.qualityScore,
      // Stated in words as well as colour: a fill does not survive a copy-paste into
      // another sheet, and this is the column Jti will filter on.
      repairStatus:
        form.outcome === 'REPAIRED'
          ? form.isReRepair
            ? 'تعمیر شد (تعمیر مجدد)'
            : 'تعمیر شد'
          : `تعمیر نشد — ${
              form.notRepairedReason
                ? (NOT_REPAIRED_LABELS_FA[form.notRepairedReason] ??
                  form.notRepairedReason)
                : 'دلیل ثبت نشده'
            }`,
      hasPreviousProjectHistory: form.hasPreviousProjectHistory,
      isReRepair: form.isReRepair,
      notRepaired: form.outcome === 'NOT_REPAIRED',
      isDoubleStand:
        (standsPerVisit.get(
          `${form.uid}|${form.date.toISOString().slice(0, 10)}`,
        )?.size ?? 1) > 1,
      standIndex: form.standIndex,
    };
  });
}

export async function buildJtiWorkbook(
  rows: JtiExportRow[],
  scope: JtiExportScope = 'MAIN',
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(scope === 'RE_REPAIR' ? 'تعمیرات مجدد' : 'گزارش', {
    // Persian sheet: read right-to-left, matching the paper form it replaces.
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  sheet.addRow(JTI_EXPORT_HEADERS);

  const header = sheet.getRow(1);
  header.font = { bold: true, size: 11 };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 42;
  header.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EEF7' },
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  rows.forEach((row, i) => {
    const added = sheet.addRow([
      i + 1, // 1  رقم
      formatJalali(row.date), // 2  تاریخ
      row.cityName, // 3  شهر
      row.uid, // 4  شناسه
      ...PART_CATALOG.map((p) => row.replaced[p.exportColumnKey] ?? 0), // 5..34
      row.digitalAddress, // 35
      row.address, // 36
      row.maintenanceDetail, // 37
      row.tel, // 38
      row.storeName, // 39
      row.managerName, // 40
      row.technicianCode, // 41
      row.formCode, // 42
      row.standQuality ?? '', // 43
      row.repairStatus, // 44
    ]);

    // The sheet must stay exactly 43 columns wide for Jti, so every marker is a row
    // tint rather than an extra column. A row can qualify for more than one, so the
    // most consequential wins:
    //   red   — the visit produced no repair
    //   blue  — one of several stands at the same uid (a "double stand")
    //   cream — this uid was already repaired in an earlier campaign
    const tint = row.notRepaired
      ? 'FFFCE4E4'
      : row.isDoubleStand
        ? 'FFDDEBF7'
        : row.hasPreviousProjectHistory
          ? 'FFFFF6E0'
          : null;

    if (tint) {
      added.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
      });
    }
  });

  // Widths: identifiers and free text need room; the 30 part columns stay narrow.
  const widths = [
    6, 12, 14, 16,
    ...PART_CATALOG.map(() => 9),
    28, 34, 46, 14, 24, 18, 14, 14, 12, 34,
  ];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const firstPartCol = 5;
  const lastPartCol = 4 + PART_CATALOG.length;
  for (let c = firstPartCol; c <= lastPartCol; c++) {
    sheet.getColumn(c).alignment = { horizontal: 'center' };
  }
  sheet.getColumn(1).alignment = { horizontal: 'center' };
  sheet.getColumn(2).alignment = { horizontal: 'center' };
  sheet.getColumn(43).alignment = { horizontal: 'center' };
  sheet.getColumn(37).alignment = { wrapText: true, vertical: 'top' };

  sheet.getColumn(JTI_EXPORT_COLUMN_COUNT).alignment = { wrapText: true, vertical: 'top' };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: JTI_EXPORT_COLUMN_COUNT },
  };

  // Colour alone is not self-describing once the file leaves this app, so the workbook
  // carries a short legend on its own sheet.
  const legend = workbook.addWorksheet('راهنما', { views: [{ rightToLeft: true }] });
  legend.getColumn(1).width = 12;
  legend.getColumn(2).width = 70;
  legend.addRow(['رنگ', 'معنی']);
  legend.getRow(1).font = { bold: true };

  for (const [argb, meaning] of [
    ['FFFCE4E4', 'تعمیر انجام نشد — دلیل در ستون Maintenance detail آمده است'],
    ['FFDDEBF7', 'استند دوم یا سوم همان شناسه (چند استند در یک فروشگاه)'],
    ['FFFFF6E0', 'این شناسه در پروژه‌های قبلی هم تعمیر شده است'],
  ] as Array<[string, string]>) {
    const row = legend.addRow(['', meaning]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    row.getCell(1).border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
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

/** One workbook per city — the shape Jti receives (§8). */
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
      buffer: await buildJtiWorkbook(cityRows, scope),
      rowCount: cityRows.length,
    });
  }
  return bundles.sort((a, b) => a.cityName.localeCompare(b.cityName, 'fa'));
}
