import 'server-only';

import ExcelJS from 'exceljs';

import { formatJalali } from '../dates';
import { JTI_EXPORT_HEADERS, PART_CATALOG } from '../parts';
import { prisma } from '../prisma';

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
 *
 * Stated assumptions (see README §"Export assumptions"):
 *  - Only REPAIRED visits produce rows — the spec says "one row per repaired stand", and
 *    an unsuccessful visit has no parts and no quality score to report.
 *  - Columns 5–34 count REPLACED parts only. Parts repaired in place are not consumed
 *    inventory (§6.8); they are described in column 37 instead so the information is not
 *    lost.
 *  - Re-repairs are included by default: the stand isn't counted twice in the repaired
 *    *statistic* (§6.3), but the parts really were consumed and Jti is owed the row. The
 *    manager can toggle this off per export.
 */

export interface JtiExportFilters {
  from?: Date;
  to?: Date;
  cityId?: string;
  includeReRepairs?: boolean;
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
}

/**
 * Column 37. Free text, so it is built to stay readable in the Persian sheet while
 * keeping the replaced/repaired distinction that columns 5–34 cannot express.
 */
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
      outcome: 'REPAIRED',
      ...(filters.includeReRepairs === false ? { isReRepair: false } : {}),
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
      stand: { select: { uid: true } },
      city: { select: { id: true, name: true } },
      technician: { select: { technicianCode: true, name: true } },
      parts: { include: { part: { select: { nameFa: true, exportColumnKey: true } } } },
    },
  });

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
      uid: form.stand.uid,
      replaced,
      digitalAddress: form.digitalAddress ?? '',
      address: form.storeAddress ?? '',
      maintenanceDetail: buildMaintenanceDetail(form.parts, form.notes),
      tel: form.storePhone ?? '',
      storeName: form.storeName ?? '',
      managerName: form.storeManagerName ?? '',
      technicianCode: form.technician.technicianCode ?? '',
      formCode: form.formCode,
      standQuality: form.qualityScore,
    };
  });
}

export async function buildJtiWorkbook(rows: JtiExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('گزارش', {
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
    sheet.addRow([
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
    ]);
  });

  // Widths: identifiers and free text need room; the 30 part columns stay narrow.
  const widths = [
    6, 12, 14, 16,
    ...PART_CATALOG.map(() => 9),
    28, 34, 46, 14, 24, 18, 14, 14, 12,
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

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 43 } };

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
    bundles.push({
      cityName,
      filename: `${safeFilename(cityName)} - ${labelForRange}.xlsx`,
      buffer: await buildJtiWorkbook(cityRows),
      rowCount: cityRows.length,
    });
  }
  return bundles.sort((a, b) => a.cityName.localeCompare(b.cityName, 'fa'));
}
