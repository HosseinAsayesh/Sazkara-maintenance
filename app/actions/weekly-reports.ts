'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager, requireActionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { generateWeeklyWorkbook, weeklyTitle } from '@/lib/weekly-reports';

import type { ActionState } from './manager';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The manager sends a weekly report to Jti: built by the app from the period's reports,
 * or a file they upload.
 */
export async function submitWeeklyReportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const manager = await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');

  const fromIso = String(formData.get('from') ?? '');
  const toIso = String(formData.get('to') ?? '');
  const projectId = String(formData.get('projectId') ?? '') || null;
  const mode = formData.get('mode') === 'UPLOAD' ? 'UPLOAD' : 'GENERATE';
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!ISO_DAY.test(fromIso) || !ISO_DAY.test(toIso)) return { error: 'periodRequired' };
  if (fromIso > toIso) return { error: 'periodOrder' };

  let fileRef: string;
  let fileName: string;

  if (mode === 'UPLOAD') {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'fileRequired' };
    if (file.size > MAX_UPLOAD_BYTES) return { error: 'fileTooLarge' };
    if (!/\.xlsx$/i.test(file.name)) return { error: 'xlsxOnly' };
    fileName = file.name;
    fileRef = await getStorage().put(Buffer.from(await file.arrayBuffer()), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      prefix: 'weekly-reports',
      filename: file.name,
    });
  } else {
    const generated = await generateWeeklyWorkbook({ fromIso, toIso, projectId });
    if (generated.rowCount === 0) return { error: 'emptyPeriod' };
    fileRef = generated.fileRef;
    fileName = generated.fileName;
  }

  await prisma.weeklyReport.create({
    data: {
      title: weeklyTitle(fromIso, toIso),
      periodFrom: new Date(`${fromIso}T00:00:00Z`),
      periodTo: new Date(`${toIso}T00:00:00Z`),
      projectId,
      source: mode === 'UPLOAD' ? 'UPLOADED' : 'GENERATED',
      fileRef,
      fileName,
      note,
      submittedById: manager.id,
    },
  });

  revalidatePath(`/${locale}/manager/weekly-reports`);
  revalidatePath(`/${locale}/client`, 'layout');
  return { ok: 'submitted' };
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
  await getStorage().delete(report.fileRef).catch(() => undefined);

  revalidatePath(`/${locale}/manager/weekly-reports`);
  revalidatePath(`/${locale}/client`, 'layout');
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

  revalidatePath(`/${locale}/client`, 'layout');
  revalidatePath(`/${locale}/manager/weekly-reports`);
  return { ok: 'approved' };
}
