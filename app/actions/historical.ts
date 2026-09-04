'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { commitHistorical, previewHistorical } from '@/lib/historical';
import { getStorage } from '@/lib/storage';

export interface HistoricalState {
  error?: string;
  preview?: {
    fileRef: string;
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
    if (!fileRef) return { error: 'parseFailed' };

    const buffer = await getStorage().get(fileRef);
    const result = await commitHistorical(buffer, { name, importedById: manager.id });

    revalidatePath(`/${locale}/manager`, 'layout');
    return { imported: { count: result.imported, skipped: result.skipped } };
  } catch (err) {
    console.error('commitHistoricalAction failed', err);
    return { error: 'parseFailed' };
  }
}
