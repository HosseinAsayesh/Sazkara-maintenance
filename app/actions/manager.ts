'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { nextTechnicianCode } from '@/lib/codes';
import { prisma } from '@/lib/prisma';
import { setAppSettings, setWageSettings, type WageKey, WAGE_KEYS } from '@/lib/settings';
import { makeStoreMatchKey } from '@/lib/text';

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

  const standId = String(formData.get('standId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const locale = String(formData.get('locale') || 'fa');

  if (!standId || (decision !== 'CONFIRM' && decision !== 'REJECT')) {
    return { error: 'generic' };
  }

  await prisma.stand.update({
    where: { id: standId },
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

  const isTehran =
    formData.get('isTehran') === 'on' ||
    makeStoreMatchKey(name) === makeStoreMatchKey('تهران');

  const existing = await prisma.city.findFirst({ where: { name } });
  if (existing) {
    await prisma.city.update({ where: { id: existing.id }, data: { isTehran } });
  } else {
    await prisma.city.create({ data: { name, isTehran } });
  }

  revalidatePath(`/${locale}/manager/settings`);
  return { ok: 'saved' };
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
