import 'server-only';

import type { DownloadKind, DownloadRequest } from '@prisma/client';

import { localDayRange } from './dates';
import {
  buildJtiWorkbook,
  collectJtiRows,
  rangeLabel,
  safeFilename,
} from './exports/jti';
import { buildPartsUsageReport, buildPartsUsageWorkbook } from './exports/parts-usage';
import { generateAndStoreEvidencePdf } from './pdf/evidence';
import { prisma } from './prisma';
import { getStorage } from './storage';

/**
 * Turning an approved request into an actual file.
 *
 * The file is built WHEN THE MANAGER APPROVES, not when Jti later clicks download. That
 * is the whole point of the gate: the manager agrees to a specific artefact, and the
 * bytes Jti receives are the ones that existed at the moment of agreement. Generating at
 * download time would mean approving a standing tap on live data — a workbook fetched a
 * fortnight later would carry figures nobody ever signed off.
 */

/** How long an approval stays good for. A stale workbook circulating inside Jti is worse
 *  than being asked again, so approval expires rather than becoming permanent. */
export const APPROVAL_TTL_DAYS = 7;

export interface DownloadParams {
  /** ISO dates, optional — absent means the whole campaign. */
  from?: string | null;
  to?: string | null;
  /** Evidence only: which city and which day. */
  cityId?: string | null;
  date?: string | null;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function contentTypeForKind(kind: DownloadKind): string {
  return kind === 'EVIDENCE_PDF' ? 'application/pdf' : XLSX;
}

export function extensionForKind(kind: DownloadKind): string {
  return kind === 'EVIDENCE_PDF' ? 'pdf' : 'xlsx';
}

/**
 * Build the file this request asked for and return its storage ref.
 *
 * Evidence goes through generateAndStoreEvidencePdf, which caches per (city, day) — so
 * approving a day the manager already generated is a file read rather than another
 * Chrome launch.
 */
export async function fulfilDownloadRequest(
  request: Pick<DownloadRequest, 'id' | 'kind' | 'projectId' | 'params'>,
  approverId: string,
): Promise<{ fileRef: string; filename: string }> {
  const params = (request.params ?? {}) as DownloadParams;
  const range = localDayRange(params.from ?? null, params.to ?? null);
  const label = rangeLabel(params.from ?? null, params.to ?? null);

  const project = await prisma.project.findUnique({
    where: { id: request.projectId },
    select: { name: true },
  });
  const projectName = project?.name ?? 'project';

  if (request.kind === 'EVIDENCE_PDF') {
    if (!params.cityId || !params.date) throw new Error('EVIDENCE_NEEDS_CITY_AND_DATE');
    const batch = await generateAndStoreEvidencePdf({
      cityId: params.cityId,
      date: new Date(params.date),
      generatedById: approverId,
    });
    return {
      fileRef: batch.fileRef,
      filename: `${safeFilename(`Evidence ${projectName} ${params.date}`)}.pdf`,
    };
  }

  const storage = getStorage();

  if (request.kind === 'PARTS_USAGE_REPORT') {
    const report = await buildPartsUsageReport({
      projectId: request.projectId,
      from: range.from,
      to: range.to,
      // Jti asks for parts in its own sheet's layout.
      model: 'JTI',
    });
    const buffer = await buildPartsUsageWorkbook(report, label);
    const fileRef = await storage.put(buffer, {
      contentType: XLSX,
      prefix: 'client-downloads',
      filename: `parts-${request.id}.xlsx`,
    });
    return { fileRef, filename: `${safeFilename(`Parts ${projectName} ${label}`)}.xlsx` };
  }

  // The two Jti workbooks differ only in scope: MAIN excludes within-project re-repairs,
  // RE_REPAIR is exactly those (§6.3).
  const scope = request.kind === 'JTI_EXPORT_REREPAIRS' ? 'RE_REPAIR' : 'MAIN';
  const rows = await collectJtiRows({
    projectId: request.projectId,
    from: range.from,
    to: range.to,
    scope,
  });
  const buffer = await buildJtiWorkbook(rows, scope);
  const fileRef = await storage.put(buffer, {
    contentType: XLSX,
    prefix: 'client-downloads',
    filename: `jti-${scope.toLowerCase()}-${request.id}.xlsx`,
  });
  return {
    fileRef,
    filename: `${safeFilename(`${projectName} ${scope} ${label}`)}.xlsx`,
  };
}

/** True once an approval has aged out. Decided here rather than in a component: reading
 *  the clock while rendering makes the output depend on when React happened to run. */
export function isExpired(
  request: Pick<DownloadRequest, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  if (request.status !== 'APPROVED' || !request.expiresAt) return false;
  return request.expiresAt.getTime() < now.getTime();
}

/** Approved, not expired, not yet spent — the three things a download must satisfy. */
export function isDownloadable(
  request: Pick<DownloadRequest, 'status' | 'expiresAt' | 'fileRef'>,
): boolean {
  if (request.status !== 'APPROVED' || !request.fileRef) return false;
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) return false;
  return true;
}
