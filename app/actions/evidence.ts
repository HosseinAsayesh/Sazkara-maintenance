'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { generateAndStoreEvidencePdf } from '@/lib/pdf/evidence';
import { getStorage } from '@/lib/storage';

export interface EvidenceState {
  error?: string;
  ok?: { url: string; standCount: number };
}

/** §9 — generate (or regenerate) the daily evidence PDF for one city. */
export async function generateEvidenceAction(
  _prev: EvidenceState,
  formData: FormData,
): Promise<EvidenceState> {
  try {
    const manager = await requireActionManager();

    const cityId = String(formData.get('cityId') ?? '');
    const dateIso = String(formData.get('date') ?? '');
    const locale = String(formData.get('locale') || 'fa');
    const force = formData.get('force') === 'true';

    if (!cityId || !dateIso) return { error: 'generic' };

    // Midday avoids any chance of the parsed instant landing on the previous local day.
    const date = new Date(`${dateIso}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return { error: 'generic' };

    const batch = await generateAndStoreEvidencePdf({
      cityId,
      date,
      generatedById: manager.id,
      force,
    });

    if (batch.standCount === 0) return { error: 'noVisits' };

    revalidatePath(`/${locale}/manager/evidence`);
    return {
      ok: { url: getStorage().url(batch.fileRef), standCount: batch.standCount },
    };
  } catch (err) {
    console.error('generateEvidenceAction failed', err);
    return { error: 'generic' };
  }
}
