'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import {
  commitHistorical,
  previewHistorical,
  type ArchiveFormat,
} from '@/lib/historical';
import { getStorage } from '@/lib/storage';

export interface HistoricalState {
  error?: string;
  preview?: {
    fileRef: string;
    /** The format the file was read with, carried into the commit step. */
    format: ArchiveFormat;
    /** Which sheet generation was detected: the current 30-part or the legacy 28-part. */
    layout: 'CURRENT' | 'LEGACY';
    rows: number;
    newStands: number;
    newStores: number;
    skipped: number;
    firstDate: string | null;
    lastDate: string | null;
    sample: Array<{ uid: string; date: string; city: string; parts: number }>;
  };
  imported?: { count: number; skipped: number };
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * The manager's explicit format choice. Auto-detection is only a default: real archives
 * carry hand-edited headers, so stating the format outright has to be possible.
 */
function readFormat(formData: FormData): ArchiveFormat {
  const raw = String(formData.get('format') ?? 'AUTO').toUpperCase();
  return raw === 'CURRENT' || raw === 'LEGACY' ? raw : 'AUTO';
}

/** §7 — dry-run a historical Jti export before writing anything. */
export async function previewHistoricalAction(
  _prev: HistoricalState,
  formData: FormData,
): Promise<HistoricalState> {
  try {
    await requireActionManager();

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'parseFailed' };
    if (file.size > MAX_UPLOAD_BYTES) return { error: 'parseFailed' };

    const format = readFormat(formData);

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = await getStorage().put(buffer, {
      prefix: 'historical',
      filename: file.name || 'history.xlsx',
    });

    const preview = await previewHistorical(buffer, format);
    if (preview.rows === 0) return { error: 'noRows' };

    return {
      preview: {
        fileRef,
        // Echoed back so the commit step reads the file exactly as the preview did.
        format,
        layout: preview.layout,
        rows: preview.rows,
        newStands: preview.newStands,
        newStores: preview.newStores,
        skipped: preview.skipped,
        firstDate: preview.firstDate?.toISOString() ?? null,
        lastDate: preview.lastDate?.toISOString() ?? null,
        sample: preview.sample,
      },
    };
  } catch (err) {
    console.error('previewHistoricalAction failed', err);
    return { error: 'parseFailed' };
  }
}

export async function commitHistoricalAction(
  _prev: HistoricalState,
  formData: FormData,
): Promise<HistoricalState> {
  try {
    const manager = await requireActionManager();

    const fileRef = String(formData.get('fileRef') ?? '');
    const name = String(formData.get('name') ?? '').trim() || 'Historical import';
    const locale = String(formData.get('locale') || 'fa');
    const projectId = String(formData.get('projectId') ?? '') || null;
    const phaseId = String(formData.get('phaseId') ?? '') || null;
    if (!fileRef) return { error: 'parseFailed' };

    // A phase from a different project would leave the batch unreachable from both.
    if (phaseId) {
      const { prisma } = await import('@/lib/prisma');
      const phase = await prisma.phase.findUnique({ where: { id: phaseId } });
      if (!phase || phase.projectId !== projectId) return { error: 'phaseMismatch' };
    }

    const buffer = await getStorage().get(fileRef);
    const result = await commitHistorical(buffer, {
      name,
      importedById: manager.id,
      projectId,
      phaseId,
      format: readFormat(formData),
      // Keep the original on the batch so the manager can download what was uploaded.
      fileRef,
    });

    revalidatePath(`/${locale}/manager`, 'layout');
    return { imported: { count: result.imported, skipped: result.skipped } };
  } catch (err) {
    console.error('commitHistoricalAction failed', err);
    return { error: 'parseFailed' };
  }
}
