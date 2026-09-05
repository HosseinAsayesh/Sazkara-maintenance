import 'server-only';

import ExcelJS from 'exceljs';

import { formatJalali } from '../dates';
import { prisma } from '../prisma';
import { projectScopeWhere } from '../projects';

/**
 * A technician's own work, or a lead's whole crew, as a spreadsheet.
 *
 * This is NOT the Jti export: it is the report a technician hands their lead, and a lead
 * hands upward. It answers "what did I do, and when", so it is one row per submitted form
 * with the store, outcome and parts spelled out.
 *
 * Deliberately carries no money. Technicians do not see their earnings in this app, and a
 * crew lead has no authority over rates or expenses — payroll stays with the manager. Add
 * a wage column here and it leaks to both.
 */

export interface WorkExportFilters {
  /** Whose work. Empty means every technician the caller is allowed to see. */
  technicianIds: string[];
  from?: Date;
  to?: Date;
  projectId?: string | null;
  phaseId?: string | null;
}

export interface WorkExportRow {
  date: Date;
  technicianName: string;
  technicianCode: string;
  formCode: string;
  uid: string;
  standIndex: number;
  storeName: string;
  cityName: string;
  projectName: string;
  phaseName: string;
  outcome: string;
  notRepairedReason: string | null;
  quality: number | null;
  timeSpentMinutes: number | null;
  isReRepair: boolean;
  replaced: string;
  repaired: string;
  notes: string;
}

export async function collectWorkRows(
  filters: WorkExportFilters,
): Promise<WorkExportRow[]> {
  const forms = await prisma.repairForm.findMany({
    where: {
      ...(filters.technicianIds.length
        ? { technicianId: { in: filters.technicianIds } }
        : {}),
      ...projectScopeWhere(filters.projectId, filters.phaseId),
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
      technician: { select: { name: true, technicianCode: true } },
      city: { select: { name: true } },
      project: { select: { name: true } },
      phase: { select: { name: true } },
      parts: { include: { part: { select: { nameFa: true, unit: true } } } },
    },
  });

  const describe = (
    parts: typeof forms[number]['parts'],
    action: 'REPLACED' | 'REPAIRED',
  ) =>
    parts
      .filter((p) => p.action === action)
      .map(
        (p) =>
          `${p.part.nameFa} (${p.quantity}${p.part.unit === 'CENTIMETER' ? ' سانتی‌متر' : ''})`,
      )
      .join('، ');

  return forms.map((form) => ({
    date: form.date,
    technicianName: form.technician.name,
    technicianCode: form.technician.technicianCode ?? '',
    formCode: form.formCode,
    uid: form.uid,
    standIndex: form.standIndex,
    storeName: form.storeName ?? '',
    cityName: form.city?.name ?? '',
    projectName: form.project?.name ?? '',
    phaseName: form.phase?.name ?? '',
    outcome: form.outcome,
    notRepairedReason: form.notRepairedReason,
    quality: form.qualityScore,
    timeSpentMinutes: form.timeSpentMinutes,
    isReRepair: form.isReRepair,
    replaced: describe(form.parts, 'REPLACED'),
    repaired: describe(form.parts, 'REPAIRED'),
    notes: form.notes ?? '',
  }));
}

const OUTCOME_FA: Record<string, string> = {
  REPAIRED: 'تعمیر شد',
  NOT_REPAIRED: 'تعمیر نشد',
};

const REASON_FA: Record<string, string> = {
  MANAGER_NOT_AUTHORIZED: 'مدیر فروشگاه اجازه نداد',
  STORE_OR_STAND_REMOVED: 'فروشگاه یا استند جمع‌آوری شده بود',
  ALREADY_HEALTHY: 'استند سالم بود',
  STORE_TEMPORARILY_CLOSED: 'فروشگاه موقتاً تعطیل بود',
  CONDITION_TOO_POOR: 'وضعیت استند برای تعمیر نامناسب بود',
};

export async function buildWorkWorkbook(
  rows: WorkExportRow[],
  title: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('کارکرد', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  sheet.addRow([
    'ردیف', 'تاریخ', 'کد تکنسین', 'نام تکنسین', 'کد فرم',
    'شناسه', 'استند', 'فروشگاه', 'شهر', 'پروژه', 'فاز',
    'وضعیت', 'علت عدم تعمیر', 'کیفیت', 'زمان (دقیقه)', 'تعمیر مجدد',
    'قطعات تعویض‌شده', 'قطعات تعمیرشده', 'توضیحات',
  ]);

  const header = sheet.getRow(1);
  header.font = { bold: true, size: 11 };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 32;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  });

  rows.forEach((row, i) => {
    sheet.addRow([
      i + 1,
      formatJalali(row.date),
      row.technicianCode,
      row.technicianName,
      row.formCode,
      row.uid,
      row.standIndex,
      row.storeName,
      row.cityName,
      row.projectName,
      row.phaseName,
      OUTCOME_FA[row.outcome] ?? row.outcome,
      row.notRepairedReason ? (REASON_FA[row.notRepairedReason] ?? row.notRepairedReason) : '',
      row.quality ?? '',
      row.timeSpentMinutes ?? '',
      row.isReRepair ? 'بله' : '',
      row.replaced,
      row.repaired,
      row.notes,
    ]);
  });

  const widths = [6, 12, 12, 18, 14, 16, 8, 24, 12, 18, 12, 12, 26, 8, 12, 10, 40, 40, 30];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  for (const c of [1, 2, 7, 14, 15, 16]) {
    sheet.getColumn(c).alignment = { horizontal: 'center' };
  }
  for (const c of [17, 18, 19]) {
    sheet.getColumn(c).alignment = { wrapText: true, vertical: 'top' };
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 19 } };

  // A short summary block under the table: the counts a lead actually reports upward.
  const repaired = rows.filter((r) => r.outcome === 'REPAIRED' && !r.isReRepair).length;
  const reRepairs = rows.filter((r) => r.isReRepair).length;
  const notRepaired = rows.filter((r) => r.outcome === 'NOT_REPAIRED').length;
  const uids = new Set(rows.map((r) => r.uid)).size;

  sheet.addRow([]);
  const summary = [
    ['خلاصه', title],
    ['تعداد شناسه‌های یکتا', uids],
    ['تعمیر شده', repaired],
    ['تعمیر مجدد', reRepairs],
    ['تعمیر نشده', notRepaired],
    ['مجموع گزارش‌ها', rows.length],
  ];
  for (const [label, value] of summary) {
    const r = sheet.addRow([label, value]);
    r.getCell(1).font = { bold: true };
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
