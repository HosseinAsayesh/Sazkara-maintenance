import 'server-only';

import ExcelJS from 'exceljs';

import { formatJalali } from '../dates';
import type { PayrollLine, getPayroll } from '../payroll';

type Payroll = Awaited<ReturnType<typeof getPayroll>>;

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } } as const;
const BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
} as const;

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, size: 11 };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 32;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
  });
}

const TOMAN = '#,##0';

/**
 * Payroll workbook: a summary sheet (one row per technician — what gets paid) and a
 * detail sheet (one row per report — what it was paid for), so a disputed total can be
 * traced line by line.
 */
export async function buildPayrollWorkbook(
  payroll: Payroll,
  lines: PayrollLine[],
  opts: { label: string; includeReRepairs: boolean },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  workbook.created = new Date();

  // --- summary ---
  const summary = workbook.addWorksheet('دستمزد', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  styleHeader(
    summary.addRow([
      'ردیف', 'کد تکنسین', 'نام تکنسین',
      'استند اول فروشگاه', 'استند دوم', 'استند سوم به بعد', 'مراجعه‌ی بدون تعمیر',
      'تعمیر مجدد (تعداد)', 'تعمیر مجدد (مبلغ)', 'مبلغ قابل پرداخت (تومان)',
    ]),
  );
  payroll.rows.forEach((r, i) => {
    summary.addRow([
      i + 1, r.code, r.name,
      r.firstStands, r.secondStands, r.thirdPlusStands, r.unrepairedVisits,
      r.reRepairs, r.reRepairAmount, r.total,
    ]);
  });
  const t = payroll.totals;
  const totalRow = summary.addRow([
    '', '', 'جمع',
    t.firstStands, t.secondStands, t.thirdPlusStands, t.unrepairedVisits,
    t.reRepairs, t.reRepairAmount, t.total,
  ]);
  totalRow.font = { bold: true };

  [6, 12, 22, 14, 12, 14, 16, 14, 16, 20].forEach((w, i) => {
    summary.getColumn(i + 1).width = w;
  });
  for (const c of [9, 10]) summary.getColumn(c).numFmt = TOMAN;
  for (const c of [1, 4, 5, 6, 7, 8]) summary.getColumn(c).alignment = { horizontal: 'center' };

  summary.addRow([]);
  summary.addRow(['بازه', opts.label]).getCell(1).font = { bold: true };
  summary
    .addRow([
      'تعمیر مجدد',
      opts.includeReRepairs ? 'در مبلغ قابل پرداخت محاسبه شده است' : 'در مبلغ قابل پرداخت محاسبه نشده است',
    ])
    .getCell(1).font = { bold: true };
  summary
    .addRow(['مبنا', 'دستمزد ثبت‌شده روی هر گزارش در زمان ارسال آن'])
    .getCell(1).font = { bold: true };

  // --- detail ---
  const detail = workbook.addWorksheet('جزئیات گزارش‌ها', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  styleHeader(
    detail.addRow([
      'ردیف', 'تاریخ', 'کد تکنسین', 'نام تکنسین', 'کد فرم', 'شناسه', 'استند',
      'شهر', 'وضعیت', 'رده‌ی دستمزد', 'تعمیر مجدد', 'مبلغ (تومان)', 'در پرداخت',
    ]),
  );
  const tierLabel = (l: PayrollLine) =>
    l.outcome !== 'REPAIRED'
      ? 'مراجعه بدون تعمیر'
      : l.tier <= 1
        ? 'استند اول'
        : l.tier === 2
          ? 'استند دوم'
          : 'استند سوم به بعد';
  lines.forEach((l, i) => {
    detail.addRow([
      i + 1, formatJalali(l.date), l.technicianCode, l.technicianName, l.formCode, l.uid,
      l.standIndex, l.cityName, l.outcome === 'REPAIRED' ? 'تعمیر شد' : 'تعمیر نشد',
      tierLabel(l), l.isReRepair ? 'بله' : '', l.amount, l.counted ? 'بله' : 'خیر',
    ]);
  });
  [6, 12, 12, 20, 14, 16, 8, 12, 12, 16, 10, 16, 10].forEach((w, i) => {
    detail.getColumn(i + 1).width = w;
  });
  detail.getColumn(12).numFmt = TOMAN;
  for (const c of [1, 2, 7, 11, 13]) detail.getColumn(c).alignment = { horizontal: 'center' };
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
