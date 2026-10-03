'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { commitHistorical, deleteHistoricalImport, previewHistorical } from '@/lib/historical';
import { getStorage } from '@/lib/storage';

export interface HistoricalState {
  error?: string;
  preview?: {
    fileRef: string;
    /** Part columns whose header disagrees with the catalogue entry behind them. */
    columnWarnings: Array<{ column: number; expected: string; found: string }>;
    rows: number;
    /** Reports to be created: one per stand. */
    forms: number;
    repaired: number;
    notRepaired: number;
    /** Stands added by the «Dubble» column. */
    extraStands: number;
    reasonBreakdown: Array<{ label: string; count: number }>;
    distinctUids: number;
    newUids: number;
    repeatedUids: number;
    skipped: number;
    firstDate: string | null;
    lastDate: string | null;
    sample: Array<{ uid: string; date: string; city: string; parts: number }>;
  };
  imported?: { count: number; skipped: number };
  deleted?: boolean;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = await getStorage().put(buffer, {
      prefix: 'historical',
      filename: file.name || 'history.xlsx',
    });

    const preview = await previewHistorical(buffer);
    if (preview.rows === 0) return { error: 'noRows' };

    return {
      preview: {
        fileRef,
        columnWarnings: preview.columnWarnings,
        rows: preview.rows,
        forms: preview.forms,
        repaired: preview.repaired,
        notRepaired: preview.notRepaired,
        extraStands: preview.extraStands,
        reasonBreakdown: preview.reasonBreakdown,
        distinctUids: preview.distinctUids,
        newUids: preview.newUids,
        repeatedUids: preview.repeatedUids,
        skipped: preview.skipped,
        firstDate: preview.firstDate?.toISOString() ?? null,
        lastDate: preview.lastDate?.toISOString() ?? null,
        sample: preview.sample,
      },
    };
  } catch (err) {
    // A file in this app's earlier 30-part layout, or anything that is not the Jti sheet.
    if (err instanceof Error && err.message.startsWith('UNSUPPORTED_LAYOUT')) {
      return { error: 'unsupportedLayout' };
    }
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

/**
 * Undo a historical import from the screen.
 *
 * Chunks commit independently, so a mid-file failure leaves earlier rows behind. Until
 * now the only remedy was a terminal command; it belongs next to the import it undoes.
 */
export async function deleteHistoricalImportAction(
  _prev: HistoricalState,
  formData: FormData,
): Promise<HistoricalState> {
  try {
    await requireActionManager();

    const batchId = String(formData.get('batchId') ?? '');
    const locale = String(formData.get('locale') || 'fa');
    if (!batchId) return { error: 'parseFailed' };

    await deleteHistoricalImport(batchId);

    revalidatePath(`/${locale}/manager`, 'layout');
    return { deleted: true };
  } catch (err) {
    console.error('deleteHistoricalImportAction failed', err);
    return { error: 'parseFailed' };
  }
}
