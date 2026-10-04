'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager, requireActionUser } from '@/lib/auth';
import { DAY_MS } from '@/lib/dates';
import { EVIDENCE_RANGE_MAX_DAYS } from '@/lib/pdf/evidence';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import {
  generateWeeklyEvidence,
  generateWeeklyWorkbook,
  stampApprovalOntoEvidence,
  weeklyTitle,
} from '@/lib/weekly-reports';

import type { ActionState } from './manager';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Nginx accepts 30 MB per request; a bigger evidence PDF is left for the app to build. */
const MAX_PDF_UPLOAD_BYTES = 28 * 1024 * 1024;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface WeeklySubmitState {
  error?: string;
  ok?: string;
  /** Reports created, one per city. */
  created?: number;
  /** Cities skipped because nothing was reported there in the period. */
  skipped?: string[];
}

function revalidateWeekly(locale: string) {
  revalidatePath(`/${locale}/manager/weekly-reports`);
  revalidatePath(`/${locale}/client`, 'layout');
}

/**
 * The manager sends weekly reports to Jti, one per city: teams work several cities in
 * parallel and each city is signed off on its own. Each report carries the Jti Excel and
 * the evidence PDF (photos, signatures) for that city, period and phase.
 *
 * GENERATE builds both files for every ticked city. UPLOAD takes the manager's own Excel
 * for one city, plus their own evidence PDF if they have one — otherwise the app builds it.
 */
export async function submitWeeklyReportAction(
  _prev: WeeklySubmitState,
  formData: FormData,
): Promise<WeeklySubmitState> {
  const manager = await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');

  const fromIso = String(formData.get('from') ?? '');
  const toIso = String(formData.get('to') ?? '');
  const projectId = String(formData.get('projectId') ?? '') || null;
  const phaseId = String(formData.get('phaseId') ?? '') || null;
  const mode = formData.get('mode') === 'UPLOAD' ? 'UPLOAD' : 'GENERATE';
  const note = String(formData.get('note') ?? '').trim() || null;
  const cityIds = [
    ...new Set(
      formData
        .getAll('cityId')
        .map((v) => String(v))
        .filter(Boolean),
    ),
  ];

  if (!ISO_DAY.test(fromIso) || !ISO_DAY.test(toIso)) return { error: 'periodRequired' };
  if (fromIso > toIso) return { error: 'periodOrder' };
  const span =
    Math.round(
      (Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / DAY_MS,
    ) + 1;
  if (span > EVIDENCE_RANGE_MAX_DAYS) return { error: 'rangeTooLong' };
  if (!cityIds.length) return { error: 'cityRequired' };
  if (mode === 'UPLOAD' && cityIds.length !== 1) return { error: 'oneCityForUpload' };

  let phaseName: string | null = null;
  if (phaseId) {
    const phase = await prisma.phase.findUnique({ where: { id: phaseId } });
    if (!phase || phase.projectId !== projectId) return { error: 'phaseMismatch' };
    phaseName = phase.name;
  }

  const cities = await prisma.city.findMany({
    where: { id: { in: cityIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (cities.length !== cityIds.length) return { error: 'cityRequired' };

  const storage = getStorage();
  const base = {
    periodFrom: new Date(`${fromIso}T00:00:00Z`),
    periodTo: new Date(`${toIso}T00:00:00Z`),
    projectId,
    phaseId,
    note,
    submittedById: manager.id,
  };

  if (mode === 'UPLOAD') {
    const city = cities[0];
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'fileRequired' };
    if (file.size > MAX_UPLOAD_BYTES) return { error: 'fileTooLarge' };
    if (!/\.xlsx$/i.test(file.name)) return { error: 'xlsxOnly' };
    const pdfFile = formData.get('evidenceFile');
    const hasPdf = pdfFile instanceof File && pdfFile.size > 0;
    if (hasPdf && pdfFile.size > MAX_PDF_UPLOAD_BYTES) return { error: 'pdfTooLarge' };
    if (hasPdf && !/\.pdf$/i.test(pdfFile.name)) return { error: 'pdfOnly' };

    const title = weeklyTitle(fromIso, toIso, { cityName: city.name, phaseName });
    const scope = { fromIso, toIso, projectId, phaseId, cityId: city.id };

    let evidence: { fileRef: string; fileName: string };
    if (hasPdf) {
      evidence = {
        fileName: pdfFile.name,
        fileRef: await storage.put(Buffer.from(await pdfFile.arrayBuffer()), {
          contentType: 'application/pdf',
          prefix: 'weekly-reports',
          filename: pdfFile.name,
        }),
      };
    } else {
      try {
        evidence = await generateWeeklyEvidence(scope, title);
      } catch (e) {
        if (e instanceof Error && e.message === 'NO_VISITS') return { error: 'noEvidence' };
        throw e;
      }
    }

    const fileRef = await storage.put(Buffer.from(await file.arrayBuffer()), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      prefix: 'weekly-reports',
      filename: file.name,
    });
    await prisma.weeklyReport.create({
      data: {
        ...base,
        title,
        cityId: city.id,
        source: 'UPLOADED',
        fileRef,
        fileName: file.name,
        evidenceFileRef: evidence.fileRef,
        evidenceFileName: evidence.fileName,
      },
    });
    revalidateWeekly(locale);
    return { ok: 'submitted', created: 1, skipped: [] };
  }

  // GENERATE: one report per ticked city. A city with nothing in the period is skipped
  // and named back to the manager rather than sent to Jti as an empty sheet.
  let created = 0;
  const skipped: string[] = [];
  for (const city of cities) {
    const title = weeklyTitle(fromIso, toIso, { cityName: city.name, phaseName });
    const scope = { fromIso, toIso, projectId, phaseId, cityId: city.id };

    const sheet = await generateWeeklyWorkbook(scope, title);
    if (sheet.rowCount === 0) {
      await storage.delete(sheet.fileRef).catch(() => undefined);
      skipped.push(city.name);
      continue;
    }
    let evidence: { fileRef: string; fileName: string } | null = null;
    try {
      evidence = await generateWeeklyEvidence(scope, title);
    } catch (e) {
      // Rows without evidence pages cannot happen with the same filters; keep the sheet
      // rather than lose the report if it ever does.
      if (!(e instanceof Error && e.message === 'NO_VISITS')) throw e;
    }

    await prisma.weeklyReport.create({
      data: {
        ...base,
        title,
        cityId: city.id,
        source: 'GENERATED',
        fileRef: sheet.fileRef,
        fileName: sheet.fileName,
        evidenceFileRef: evidence?.fileRef ?? null,
        evidenceFileName: evidence?.fileName ?? null,
      },
    });
    created++;
  }

  if (created === 0) return { error: 'emptyPeriod', skipped };
  revalidateWeekly(locale);
  return { ok: 'submitted', created, skipped };
}

/** Takes back a report Jti has not approved yet — a wrong period, the wrong file. */
export async function withdrawWeeklyReportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');
  const id = String(formData.get('id') ?? '');

  const report = await prisma.weeklyReport.findUnique({ where: { id } });
  if (!report) return { error: 'notFound' };
  // An approved report is a signed record; it stays.
  if (report.status === 'APPROVED') return { error: 'alreadyApproved' };

  await prisma.weeklyReport.delete({ where: { id } });
  const storage = getStorage();
  await storage.delete(report.fileRef).catch(() => undefined);
  if (report.evidenceFileRef) {
    await storage.delete(report.evidenceFileRef).catch(() => undefined);
  }

  revalidateWeekly(locale);
  return { ok: 'withdrawn' };
}

/**
 * Jti approves: their name and their drawn signature. Only the Jti account may sign —
 * a manager looking through the Jti view must not be able to approve on their behalf —
 * and only after the file has been opened.
 */
export async function approveWeeklyReportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireActionUser();
  if (user.role !== 'CLIENT_SUPERVISOR') return { error: 'forbidden' };
  const locale = String(formData.get('locale') || 'fa');

  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('approverName') ?? '').trim();
  const signature = formData.get('signature');

  const report = await prisma.weeklyReport.findUnique({ where: { id } });
  if (!report) return { error: 'notFound' };
  if (report.status === 'APPROVED') return { error: 'alreadyApproved' };
  if (!report.firstViewedAt) return { error: 'viewFirst' };
  if (name.length < 2) return { error: 'nameRequired' };
  if (!(signature instanceof File) || signature.size === 0) return { error: 'signatureRequired' };
  if (signature.size > 2 * 1024 * 1024) return { error: 'signatureRequired' };

  const signatureRef = await getStorage().put(Buffer.from(await signature.arrayBuffer()), {
    contentType: 'image/png',
    prefix: 'weekly-reports/signatures',
    filename: 'signature.png',
  });

  await prisma.weeklyReport.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approverName: name,
      approverSignatureRef: signatureRef,
      approvedById: user.id,
    },
  });

  // The signed approval becomes the evidence PDF's last page.
  await stampApprovalOntoEvidence(id);

  revalidatePath(`/${locale}/client`, 'layout');
  revalidatePath(`/${locale}/manager/weekly-reports`);
  return { ok: 'approved' };
}
