import 'server-only';

import { PDFDocument } from 'pdf-lib';

import { formatJalali, localDayRange } from './dates';
import { buildJtiWorkbook, collectJtiRows, safeFilename } from './exports/jti';
import { generateEvidenceRangePdf, htmlToPdf } from './pdf/evidence';
import { prisma } from './prisma';
import { getStorage } from './storage';

/**
 * Weekly reports: the manager sends Jti a period's work for sign-off, one city at a time
 * (teams work several cities in parallel), and Jti approves it with name and signature
 * once they have opened it.
 *
 * Each report is two files: the Jti Excel sheet and the evidence PDF — every visit with
 * its photos and signatures, which is what "the PDF" means to Jti. The Excel is built
 * here or uploaded by the manager; the evidence PDF is built here or uploaded too.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface WeeklyScope {
  fromIso: string;
  toIso: string;
  projectId: string | null;
  phaseId: string | null;
  cityId: string;
}

export function weeklyTitle(
  fromIso: string,
  toIso: string,
  extra: { cityName?: string | null; phaseName?: string | null } = {},
): string {
  const fmt = (iso: string) => formatJalali(new Date(`${iso}T12:00:00Z`));
  const parts = [`گزارش هفتگی ${fmt(fromIso)} تا ${fmt(toIso)}`];
  if (extra.cityName) parts.push(extra.cityName);
  if (extra.phaseName) parts.push(extra.phaseName);
  return parts.join(' — ');
}

function fileBase(title: string): string {
  return safeFilename(title.replace(/\//g, '.'));
}

/** Builds the period's Jti sheet for one city and stores it. */
export async function generateWeeklyWorkbook(
  scope: WeeklyScope,
  title: string,
): Promise<{ fileRef: string; fileName: string; rowCount: number }> {
  const range = localDayRange(scope.fromIso, scope.toIso);
  const rows = await collectJtiRows({
    from: range.from,
    to: range.to,
    projectId: scope.projectId,
    phaseId: scope.phaseId,
    cityId: scope.cityId,
    scope: 'MAIN',
  });
  const buffer = await buildJtiWorkbook(rows, 'MAIN', 'گزارش هفتگی');
  const fileName = `${fileBase(title)}.xlsx`;
  const fileRef = await getStorage().put(buffer, {
    contentType: XLSX,
    prefix: 'weekly-reports',
    filename: fileName,
  });
  return { fileRef, fileName, rowCount: rows.length };
}

/**
 * The evidence PDF for the same city, period and phase: every visit's page with its
 * photos and signatures. Re-repairs stay out, as they do in the sheet beside it.
 * Throws NO_VISITS when there is nothing to show.
 */
export async function generateWeeklyEvidence(
  scope: WeeklyScope,
  title: string,
): Promise<{ fileRef: string; fileName: string; standCount: number }> {
  const { buffer, standCount } = await generateEvidenceRangePdf({
    cityId: scope.cityId,
    fromIso: scope.fromIso,
    toIso: scope.toIso,
    projectId: scope.projectId,
    phaseId: scope.phaseId,
    excludeReRepairs: true,
  });
  const fileName = `${fileBase(title)}.pdf`;
  const fileRef = await getStorage().put(buffer, {
    contentType: 'application/pdf',
    prefix: 'weekly-reports',
    filename: fileName,
  });
  return { fileRef, fileName, standCount };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Once Jti signs, the evidence PDF gets one more page: the approval, with the name, the
 * date and the drawn signature. The signed file replaces the unsigned one, so whoever
 * downloads it later gets the record as approved.
 */
export async function stampApprovalOntoEvidence(reportId: string): Promise<void> {
  const report = await prisma.weeklyReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      project: { select: { name: true } },
      phase: { select: { name: true } },
      city: { select: { name: true } },
    },
  });
  if (!report.evidenceFileRef || report.status !== 'APPROVED') return;
  const storage = getStorage();
  if (!(await storage.exists(report.evidenceFileRef))) return;

  let signature = '';
  if (report.approverSignatureRef && (await storage.exists(report.approverSignatureRef))) {
    const bytes = await storage.get(report.approverSignatureRef);
    signature = `<img src="data:image/png;base64,${bytes.toString('base64')}" alt="">`;
  }

  const row = (label: string, value: string | null | undefined) =>
    value ? `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>` : '';

  const page = await htmlToPdf(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
    body { font-family: Vazirmatn, Tahoma, 'Noto Naskh Arabic', sans-serif; color: #17202a; margin: 0; }
    .page { padding: 30mm 22mm; }
    h1 { font-size: 20px; margin: 0 0 14mm; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #9aa5b4; padding: 8px 10px; text-align: right; }
    th { background: #e8eef7; width: 32%; }
    .sig { margin-top: 12mm; border: 1px solid #9aa5b4; padding: 10px; min-height: 40mm; }
    .sig img { max-height: 40mm; }
    .sig .cap { font-size: 12px; color: #4a5a70; margin-bottom: 6px; }
  </style></head><body><div class="page">
    <h1>تأیید گزارش هفتگی</h1>
    <table>
      ${row('گزارش', report.title)}
      ${row('پروژه', report.project?.name)}
      ${row('فاز', report.phase?.name)}
      ${row('شهر', report.city?.name)}
      ${row('تأییدکننده (ناظر جی‌تی‌آی)', report.approverName)}
      ${row('تاریخ تأیید', report.approvedAt ? formatJalali(report.approvedAt) : null)}
    </table>
    <div class="sig"><div class="cap">امضا</div>${signature}</div>
  </div></body></html>`);

  const evidence = await PDFDocument.load(await storage.get(report.evidenceFileRef));
  const approval = await PDFDocument.load(page);
  for (const copied of await evidence.copyPages(approval, approval.getPageIndices())) {
    evidence.addPage(copied);
  }
  const signed = Buffer.from(await evidence.save());

  const signedRef = await storage.put(signed, {
    contentType: 'application/pdf',
    prefix: 'weekly-reports',
    filename: report.evidenceFileName ?? 'evidence.pdf',
  });
  await prisma.weeklyReport.update({
    where: { id: reportId },
    data: { evidenceFileRef: signedRef },
  });
  await storage.delete(report.evidenceFileRef).catch(() => undefined);
}
