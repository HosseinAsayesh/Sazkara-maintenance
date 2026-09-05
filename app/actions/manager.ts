'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { nextTechnicianCode } from '@/lib/codes';
import {
  CityMergeError,
  addOrMatchCity,
  deleteCityIfUnused,
  mergeCities,
} from '@/lib/cities';
import { prisma } from '@/lib/prisma';
import { setAppSettings, setWageSettings, type WageKey, WAGE_KEYS } from '@/lib/settings';

export interface ActionState {
  error?: string;
  ok?: string;
}

/** §7 — approve/reject technician sign-ups. Approval is when a code is assigned. */
export async function reviewTechnicianAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const userId = String(formData.get('userId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const locale = String(formData.get('locale') || 'fa');

  if (!userId || (decision !== 'APPROVE' && decision !== 'REJECT')) {
    return { error: 'generic' };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'TECHNICIAN') return { error: 'notFound' };

  if (decision === 'REJECT') {
    await prisma.user.update({ where: { id: userId }, data: { status: 'REJECTED' } });
  } else {
    await prisma.$transaction(async (tx) => {
      // Keep an already-issued code stable if the account is re-approved later.
      const code = user.technicianCode ?? (await nextTechnicianCode(tx));
      await tx.user.update({
        where: { id: userId },
        data: { status: 'APPROVED', technicianCode: code },
      });
    });
  }

  revalidatePath(`/${locale}/manager/technicians`);
  revalidatePath(`/${locale}/manager`, 'layout');
  return { ok: 'success' };
}

/** §6.2 — admit (or reject) a uid that was added outside the official order. */
export async function reviewStandAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const storeId = String(formData.get('standId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const locale = String(formData.get('locale') || 'fa');

  if (!storeId || (decision !== 'CONFIRM' && decision !== 'REJECT')) {
    return { error: 'generic' };
  }

  // §6.2 admits (or rejects) the whole location, since the uid names a store rather
  // than an individual stand.
  await prisma.store.update({
    where: { id: storeId },
    data: { confirmation: decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED' },
  });

  revalidatePath(`/${locale}/manager/pending-uids`);
  revalidatePath(`/${locale}/manager`, 'layout');
  return { ok: 'success' };
}

/** §6.6 — wage rates and company details. */
export async function saveSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');

  const wages: Partial<Record<WageKey, number>> = {};
  for (const key of WAGE_KEYS) {
    const raw = formData.get(key);
    if (raw === null || raw === '') continue;
    const value = Number(String(raw).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(value) || value < 0) return { error: 'generic' };
    wages[key] = value;
  }

  await setWageSettings(wages);

  await setAppSettings({
    companyName: String(formData.get('companyName') ?? '').trim(),
    managerContactEmail: String(formData.get('managerContactEmail') ?? '').trim(),
  });

  revalidatePath(`/${locale}/manager/settings`);
  return { ok: 'saved' };
}

export async function addCityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const name = String(formData.get('cityName') ?? '').trim();
  const locale = String(formData.get('locale') || 'fa');
  if (!name) return { error: 'generic' };

  const { created } = await addOrMatchCity(name, formData.get('isTehran') === 'on');

  // Cities feed the dashboard and export filters, not just the settings page.
  revalidatePath(`/${locale}/manager`, 'layout');
  return { ok: created ? 'saved' : 'cityExists' };
}

export async function toggleCityTehranAction(formData: FormData) {
  await requireActionManager();
  const cityId = String(formData.get('cityId') ?? '');
  const isTehran = formData.get('isTehran') === 'true';
  const locale = String(formData.get('locale') || 'fa');
  if (!cityId) return;

  await prisma.city.update({ where: { id: cityId }, data: { isTehran } });
  revalidatePath(`/${locale}/manager/settings`);
}

/**
 * Fold one city into another (§6.6 depends on this being right).
 *
 * Duplicate cities used to arise whenever a sheet spelled a city differently — `Tehran`
 * beside `تهران`. That splits the city's stores, forms and, for Tehran, its wage bucket,
 * so the dashboard's Tehran-vs-other-cities split silently under-reports. Creation is now
 * normalised, and this repairs databases that already drifted.
 */
export async function mergeCitiesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const sourceId = String(formData.get('sourceId') ?? '');
  const targetId = String(formData.get('targetId') ?? '');

  if (!sourceId || !targetId) return { error: 'generic' };
  if (sourceId === targetId) return { error: 'sameCity' };

  try {
    await mergeCities(sourceId, targetId);
  } catch (err) {
    if (err instanceof CityMergeError) {
      return { error: err.code === 'SAME_CITY' ? 'sameCity' : 'notFound' };
    }
    console.error('mergeCitiesAction failed', err);
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/manager`, 'layout');
  return { ok: 'saved' };
}

/** Remove a city nothing points at — the tidy-up after a merge, or a mistyped entry. */
export async function deleteCityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const cityId = String(formData.get('cityId') ?? '');
  if (!cityId) return { error: 'generic' };

  try {
    await deleteCityIfUnused(cityId);
  } catch (err) {
    if (err instanceof CityMergeError) return { error: 'cityInUse' };
    console.error('deleteCityAction failed', err);
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/manager`, 'layout');
  return { ok: 'saved' };
}
