'use server';

import type { DownloadKind } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { requireActionManager, requireActionUser } from '@/lib/auth';
import {
  APPROVAL_TTL_DAYS,
  fulfilDownloadRequest,
  type DownloadParams,
} from '@/lib/client-downloads';
import { getClientScope } from '@/lib/client-view';
import { prisma } from '@/lib/prisma';

export interface DownloadActionState {
  error?: string;
  ok?: string;
}

const KINDS: DownloadKind[] = [
  'JTI_EXPORT_MAIN',
  'JTI_EXPORT_REREPAIRS',
  'PARTS_USAGE_REPORT',
  'EVIDENCE_PDF',
];

/**
 * Jti asks for a file.
 *
 * A reason is required, not decorative: the manager is being asked to judge a request,
 * and an unexplained one cannot be judged — it can only be rubber-stamped or refused
 * arbitrarily, and both are worse than a sentence of context.
 */
export async function requestDownloadAction(
  _prev: DownloadActionState,
  formData: FormData,
): Promise<DownloadActionState> {
  const user = await requireActionUser();
  if (user.role !== 'CLIENT_SUPERVISOR' && user.role !== 'MANAGER') {
    throw new Error('FORBIDDEN');
  }

  const kind = String(formData.get('kind') ?? '') as DownloadKind;
  if (!KINDS.includes(kind)) return { error: 'generic' };

  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 3) return { error: 'reasonRequired' };

  const scope = await getClientScope();
  if (!scope) return { error: 'noActiveProject' };

  const params: DownloadParams = {
    from: String(formData.get('from') ?? '') || null,
    to: String(formData.get('to') ?? '') || null,
    cityId: String(formData.get('cityId') ?? '') || null,
    date: String(formData.get('date') ?? '') || null,
  };

  if (kind === 'EVIDENCE_PDF' && (!params.cityId || !params.date)) {
    return { error: 'evidenceNeedsCityAndDate' };
  }

  await prisma.downloadRequest.create({
    data: {
      kind,
      requestedById: user.id,
      projectId: scope.projectId,
      params: params as object,
      reason,
    },
  });

  const locale = String(formData.get('locale') || 'fa');
  revalidatePath(`/${locale}/client/downloads`);
  revalidatePath(`/${locale}/manager/download-requests`);
  return { ok: 'requested' };
}

/**
 * The manager decides.
 *
 * Approving builds the file immediately and stamps an expiry, so what Jti downloads is
 * what was approved rather than whatever the data says when they get round to clicking.
 * A refusal carries a note — silence on a refusal only produces a phone call.
 */
export async function decideDownloadAction(
  _prev: DownloadActionState,
  formData: FormData,
): Promise<DownloadActionState> {
  const manager = await requireActionManager();

  const id = String(formData.get('id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;
  const locale = String(formData.get('locale') || 'fa');

  if (!id || (decision !== 'APPROVE' && decision !== 'DENY')) return { error: 'generic' };

  const request = await prisma.downloadRequest.findUnique({ where: { id } });
  if (!request) return { error: 'notFound' };
  if (request.status !== 'PENDING') return { error: 'alreadyDecided' };

  if (decision === 'DENY') {
    await prisma.downloadRequest.update({
      where: { id },
      data: {
        status: 'DENIED',
        decidedById: manager.id,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    revalidatePath(`/${locale}/manager/download-requests`);
    revalidatePath(`/${locale}/client/downloads`);
    return { ok: 'denied' };
  }

  let fileRef: string;
  try {
    const built = await fulfilDownloadRequest(request, manager.id);
    fileRef = built.fileRef;
  } catch (err) {
    // The request stays PENDING so it can be approved again once the cause is fixed —
    // a failed build must not silently consume the manager's decision.
    console.error('fulfilDownloadRequest failed', err);
    return { error: 'buildFailed' };
  }

  const expiresAt = new Date(Date.now() + APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.downloadRequest.update({
    where: { id },
    data: {
      status: 'APPROVED',
      decidedById: manager.id,
      decidedAt: new Date(),
      decisionNote: note,
      fileRef,
      expiresAt,
    },
  });

  revalidatePath(`/${locale}/manager/download-requests`);
  revalidatePath(`/${locale}/client/downloads`);
  return { ok: 'approved' };
}
