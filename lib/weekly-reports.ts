import 'server-only';

import ExcelJS from 'exceljs';
import puppeteer from 'puppeteer-core';

import { formatJalali, localDayRange } from './dates';
import { buildJtiWorkbook, collectJtiRows, safeFilename } from './exports/jti';
import { findChromeExecutable } from './pdf/chrome';
import { prisma } from './prisma';
import { getStorage } from './storage';

/**
 * Weekly reports: the manager sends Jti a period's Excel for sign-off, and Jti approves
 * it with name and signature once they have opened it. The file is either built here
 * from the period's reports (the Jti sheet, MAIN scope) or uploaded by the manager.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function weeklyTitle(fromIso: string, toIso: string): string {
  const fmt = (iso: string) => formatJalali(new Date(`${iso}T12:00:00Z`));
  return `گزارش هفتگی ${fmt(fromIso)} تا ${fmt(toIso)}`;
}

/** Builds the period's Jti sheet and stores it. */
export async function generateWeeklyWorkbook(params: {
  fromIso: string;
  toIso: string;
  projectId: string | null;
}): Promise<{ fileRef: string; fileName: string; rowCount: number }> {
  const range = localDayRange(params.fromIso, params.toIso);
  const rows = await collectJtiRows({
    from: range.from,
    to: range.to,
    projectId: params.projectId,
    scope: 'MAIN',
  });
  const buffer = await buildJtiWorkbook(rows, 'MAIN', 'گزارش هفتگی');
  const fileName = `${safeFilename(weeklyTitle(params.fromIso, params.toIso).replace(/\//g, '.'))}.xlsx`;
  const fileRef = await getStorage().put(buffer, {
    contentType: XLSX,
    prefix: 'weekly-reports',
    filename: fileName,
  });
  return { fileRef, fileName, rowCount: rows.length };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatJalali(v);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((r) => r.text).join('');
    if (typeof o.text === 'string') return o.text;
    if ('result' in o) return String(o.result ?? '');
    return '';
  }
  return String(v);
}

/**
 * The report as a PDF: the workbook's first sheet laid out as a table, with the approval
 * — name, date, signature — printed under it once Jti has signed. Works for uploaded
 * files too, because it reads whatever the sheet holds rather than rebuilding it.
 */
export async function renderWeeklyReportPdf(reportId: string): Promise<Buffer> {
  const report = await prisma.weeklyReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { project: { select: { name: true } } },
  });
  const storage = getStorage();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await storage.get(report.fileRef)) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];

  // Trim to the columns and rows that hold anything, so an empty tail is not printed.
  let lastCol = 0;
  let lastRow = 0;
  sheet.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      if (cellString(cell).trim()) {
        lastCol = Math.max(lastCol, c);
        lastRow = Math.max(lastRow, r);
      }
    });
  });

  // The sheet's own column widths, as shares of the page, so a date or a uid is not
  // squeezed onto three lines while an empty part column takes the same room.
  const widths = Array.from({ length: lastCol }, (_, i) => sheet.getColumn(i + 1).width ?? 10);
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const colgroup = `<colgroup>${widths
    .map((w) => `<col style="width:${((w / totalWidth) * 100).toFixed(2)}%">`)
    .join('')}</colgroup>`;

  const rowsHtml: string[] = [];
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      const tag = r <= 2 ? 'th' : 'td';
      cells.push(`<${tag}>${escapeHtml(cellString(row.getCell(c)))}</${tag}>`);
    }
    rowsHtml.push(`<tr>${cells.join('')}</tr>`);
  }

  let approvalHtml = '';
  if (report.status === 'APPROVED') {
    let signature = '';
    if (report.approverSignatureRef && (await storage.exists(report.approverSignatureRef))) {
      const bytes = await storage.get(report.approverSignatureRef);
      signature = `<img src="data:image/png;base64,${bytes.toString('base64')}" alt="">`;
    }
    approvalHtml = `
      <div class="approval">
        <div><b>تأیید ناظر جی‌تی‌آی:</b> ${escapeHtml(report.approverName)}</div>
        <div><b>تاریخ تأیید:</b> ${escapeHtml(report.approvedAt ? formatJalali(report.approvedAt) : '')}</div>
        <div class="sig">${signature}</div>
      </div>`;
  }

  const html = `<!doctype html><html lang="fa"><head><meta charset="utf-8"><style>
    @page { size: A3 landscape; margin: 10mm; }
    body { font-family: Vazirmatn, Tahoma, 'Noto Naskh Arabic', sans-serif; font-size: 7px; color: #17202a; }
    h1 { font-size: 13px; margin: 0 0 2px; direction: rtl; }
    .meta { font-size: 9px; color: #4a5a70; margin-bottom: 6px; direction: rtl; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 0.5px solid #9aa5b4; padding: 1.5px 2px; vertical-align: top; word-break: break-word; }
    th { background: #e8eef7; font-weight: 600; }
    tr { page-break-inside: avoid; }
    .approval { margin-top: 10px; font-size: 10px; direction: rtl; border: 1px solid #9aa5b4; padding: 8px; display: inline-block; }
    .sig img { max-height: 60px; margin-top: 4px; }
  </style></head><body>
    <h1>${escapeHtml(report.title)}</h1>
    <div class="meta">${escapeHtml(report.project?.name ?? '')} ${report.note ? '— ' + escapeHtml(report.note) : ''}</div>
    <table>${colgroup}${rowsHtml.join('')}</table>
    ${approvalHtml}
  </body></html>`;

  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
