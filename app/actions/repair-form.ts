'use server';

import type { NotRepairedReason, PartAction, PhotoType } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/lib/auth';
import { localDayKey } from '@/lib/dates';
import {
  createRepairForm,
  RepairFormError,
  type PartEntryInput,
  type PhotoInput,
} from '@/lib/repair-forms';
import { getStorage } from '@/lib/storage';

export interface RepairFormState {
  /** Translation key under `form.errors`, or `common.error`. */
  error?: string;
  success?: {
    formCode: string;
    outcome: string;
    isReRepair: boolean;
    /** Form codes for the additional stands serviced at the same store (§6.6). */
    extraFormCodes?: string[];
  };
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function storeImage(
  file: File | null,
  prefix: string,
): Promise<string | undefined> {
  if (!file || file.size === 0) return undefined;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new RepairFormError('INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_BYTES) throw new RepairFormError('IMAGE_TOO_LARGE');

  const bytes = Buffer.from(await file.arrayBuffer());
  return getStorage().put(bytes, { prefix, filename: file.name || 'image.png' });
}

/** `REPLACED:<partId>:<qty>` — the encoding PartPicker writes into hidden inputs. */
function parsePartEntries(values: FormDataEntryValue[]): PartEntryInput[] {
  const out: PartEntryInput[] = [];
  for (const raw of values) {
    const [action, partCatalogItemId, qty] = String(raw).split(':');
    if (action !== 'REPLACED' && action !== 'REPAIRED') continue;
    if (!partCatalogItemId) continue;
    const quantity = Number(qty);
    // Upper bound covers the centimetre-measured SMD strips; the exact step/unit rule is
    // enforced against the catalogue in createRepairForm.
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 5000) continue;
    out.push({ partCatalogItemId, action: action as PartAction, quantity });
  }
  return out;
}

export async function submitRepairFormAction(
  _prev: RepairFormState,
  formData: FormData,
): Promise<RepairFormState> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'TECHNICIAN') return { error: 'unauthorized' };

  const uid = String(formData.get('uid') ?? '').trim();
  if (!uid) return { error: 'uidRequired' };

  const locale = String(formData.get('locale') || 'fa');
  const dayPrefix = localDayKey(new Date());

  try {
    const parts = parsePartEntries(formData.getAll('parts'));

    // Photos and signatures are written to storage before the transaction so a failed
    // validation never leaves a half-written form; orphaned files are cheap and are
    // never referenced by any row.
    const photos: PhotoInput[] = [];
    for (const [field, type] of [
      ['photoStore', 'STORE'],
      ['photoBefore', 'BEFORE'],
      ['photoAfter', 'AFTER'],
    ] as Array<[string, PhotoType]>) {
      const ref = await storeImage(formData.get(field) as File | null, `photos/${dayPrefix}`);
      if (ref) photos.push({ type, fileRef: ref });
    }

    for (const extra of formData.getAll('photoOther')) {
      const ref = await storeImage(extra as File, `photos/${dayPrefix}`);
      if (ref) photos.push({ type: 'OTHER', fileRef: ref });
    }

    const [technicianSignature, storeManagerSignature] = await Promise.all([
      storeImage(formData.get('technicianSignature') as File | null, `signatures/${dayPrefix}`),
      storeImage(
        formData.get('storeManagerSignature') as File | null,
        `signatures/${dayPrefix}`,
      ),
    ]);

    const qualityRaw = formData.get('qualityScore');
    const timeRaw = formData.get('timeSpentMinutes');
    const reason = formData.get('notRepairedReason');

    const sharedStore = {
      cityId: (formData.get('cityId') as string) || null,
      storeName: String(formData.get('storeName') ?? ''),
      storeAddress: String(formData.get('storeAddress') ?? ''),
      storeManagerName: String(formData.get('storeManagerName') ?? ''),
      storePhone: String(formData.get('storePhone') ?? ''),
      digitalAddress: String(formData.get('digitalAddress') ?? ''),
    };

    const result = await createRepairForm({
      uid,
      technicianId: user.id,
      ...sharedStore,
      parts,
      notRepairedReason: reason ? (String(reason) as NotRepairedReason) : null,
      qualityScore: qualityRaw !== null && qualityRaw !== '' ? Number(qualityRaw) : null,
      timeSpentMinutes: timeRaw ? Number(timeRaw) : null,
      notes: String(formData.get('notes') ?? ''),
      technicianSignature,
      storeManagerSignature,
      photos,
    });

    // --- Additional stands at the same store (§6.6, "double stands") ---------
    //
    // Each extra stand becomes its OWN RepairForm: the Jti export is one row per stand,
    // and parts, quality and outcome are all per-stand facts. They are created strictly
    // after the primary and one at a time, because the wage tier is derived from how
    // many stands the technician has already serviced at this store today — creating
    // them in parallel would race and hand two stands the same tier.
    //
    // What they share with the primary visit: the store details, both signatures, and
    // the store photo. What is theirs alone: uid, parts, quality, notes, and their own
    // before/after photos, since those are evidence about a specific stand.
    const extraCount = Math.min(Number(formData.get('extraStandCount') ?? 0) || 0, 10);
    const storePhotoRef = photos.find((p) => p.type === 'STORE')?.fileRef;
    const extraFormCodes: string[] = [];

    for (let i = 0; i < extraCount; i++) {
      const extraUid = String(formData.get(`extra_${i}_uid`) ?? '').trim();
      if (!extraUid) continue;

      const extraPhotos: PhotoInput[] = [];
      if (storePhotoRef) extraPhotos.push({ type: 'STORE', fileRef: storePhotoRef });
      for (const [field, type] of [
        [`extra_${i}_photoBefore`, 'BEFORE'],
        [`extra_${i}_photoAfter`, 'AFTER'],
      ] as Array<[string, PhotoType]>) {
        const ref = await storeImage(
          formData.get(field) as File | null,
          `photos/${dayPrefix}`,
        );
        if (ref) extraPhotos.push({ type, fileRef: ref });
      }

      const extraQuality = formData.get(`extra_${i}_quality`);
      const extraReason = formData.get(`extra_${i}_reason`);
      const extraTime = formData.get(`extra_${i}_time`);

      const extra = await createRepairForm({
        uid: extraUid,
        technicianId: user.id,
        ...sharedStore,
        parts: parsePartEntries(formData.getAll(`extra_${i}_parts`)),
        notRepairedReason: extraReason
          ? (String(extraReason) as NotRepairedReason)
          : null,
        qualityScore:
          extraQuality !== null && extraQuality !== ''
            ? Number(extraQuality)
            : null,
        timeSpentMinutes: extraTime ? Number(extraTime) : null,
        notes: String(formData.get(`extra_${i}_notes`) ?? ''),
        technicianSignature,
        storeManagerSignature,
        photos: extraPhotos,
      });

      extraFormCodes.push(extra.form.formCode);
    }

    // The manager dashboard must reflect a submission immediately (§7 "near-real-time").
    revalidatePath(`/${locale}/manager`, 'layout');
    revalidatePath(`/${locale}/technician`, 'layout');

    return {
      success: {
        formCode: result.form.formCode,
        outcome: result.outcome,
        isReRepair: result.isReRepair,
        extraFormCodes,
      },
    };
  } catch (err) {
    if (err instanceof RepairFormError) {
      const map: Record<string, string> = {
        UID_REQUIRED: 'uidRequired',
        REASON_REQUIRED: 'reasonRequired',
        QUALITY_REQUIRED: 'qualityRequired',
        QUALITY_OUT_OF_RANGE: 'qualityRequired',
        SIGNATURES_REQUIRED: 'signaturesRequired',
        PHOTOS_REQUIRED: 'photosRequired',
        INVALID_IMAGE_TYPE: 'photosRequired',
        IMAGE_TOO_LARGE: 'photosRequired',
        INVALID_QUANTITY: 'invalidQuantity',
        UNKNOWN_PART: 'submitFailed',
      };
      return { error: map[err.code] ?? 'submitFailed' };
    }
    console.error('submitRepairFormAction failed', err);
    return { error: 'submitFailed' };
  }
}
