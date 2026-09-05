'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireActionManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { computeWage } from '@/lib/wages';

export interface ActionState {
  error?: string;
  ok?: string;
}

/**
 * Manager corrections to a submitted repair form.
 *
 * Technicians fill these in on a phone, in a shop, under time pressure — a wrong quality
 * score or a form filed against the wrong uid is routine. Until now the record was
 * append-only, so the only remedy was a second form that double-counted the stand.
 *
 * Deleting removes the form, its parts and its photo rows, and reopens the order line so
 * the uid drops back into the technician's queue to be redone. The uploaded image files
 * are deleted too, since nothing else references them.
 *
 * Editing is deliberately limited to fields that do not require the technician to be
 * standing in the shop: store details, date, quality, time, notes. Parts are editable
 * because a mis-tapped part is the most common error, and changing them re-derives the
 * outcome (§6.1) and the wage (§6.6) rather than leaving stale numbers behind.
 */

function revalidateForm(locale: string) {
  revalidatePath(`/${locale}/manager`, 'layout');
}

export async function deleteRepairFormAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const formId = String(formData.get('formId') ?? '');
  if (!formId) return { error: 'generic' };

  const form = await prisma.repairForm.findUnique({
    where: { id: formId },
    include: { photos: true },
  });
  if (!form) return { error: 'notFound' };

  const storage = getStorage();
  const refs = [
    ...form.photos.map((p) => p.fileRef),
    form.technicianSignature,
    form.storeManagerSignature,
  ].filter((r): r is string => !!r);

  await prisma.$transaction(async (tx) => {
    // PartUsage and Photo cascade with the form (see the schema relations).
    await tx.repairForm.delete({ where: { id: formId } });

    // Put the work back on the board: if no other form still covers this uid, the order
    // line goes back to PENDING so it reappears as outstanding.
    const remaining = await tx.repairForm.count({ where: { uid: form.uid } });
    if (remaining === 0) {
      await tx.orderLine.updateMany({
        where: { uid: form.uid, status: 'DONE' },
        data: { status: 'PENDING' },
      });
    }
  });

  // Files last: if the transaction rolled back, the images are still referenced.
  await Promise.all(refs.map((ref) => storage.delete(ref).catch(() => {})));

  revalidateForm(locale);

  // The caller is standing on /manager/form/<id>, which has just ceased to exist —
  // re-rendering it would hit notFound() and show a 404 instead of a confirmation. Send
  // them to the uid's history, which is where they need to be anyway to re-file the
  // report, and carry a flag so that page can confirm the deletion.
  redirect(
    `/${locale}/manager/uid?q=${encodeURIComponent(form.uid)}` +
      `&deleted=${encodeURIComponent(form.formCode)}`,
  );
}

export async function updateRepairFormAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const formId = String(formData.get('formId') ?? '');
  if (!formId) return { error: 'generic' };

  const existing = await prisma.repairForm.findUnique({
    where: { id: formId },
    include: { city: true },
  });
  if (!existing) return { error: 'notFound' };

  const text = (key: string) => {
    const value = String(formData.get(key) ?? '').trim();
    return value || null;
  };
  const num = (key: string) => {
    const raw = String(formData.get(key) ?? '').trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const quality = num('qualityScore');
  if (quality !== null && (quality < 0 || quality > 5)) {
    return { error: 'qualityOutOfRange' };
  }

  const dateIso = String(formData.get('date') ?? '').trim();
  const date = dateIso ? new Date(`${dateIso}T12:00:00Z`) : existing.date;
  if (Number.isNaN(date.getTime())) return { error: 'generic' };

  // `parts` arrives in the same `ACTION:partId:qty` encoding the technician's picker uses.
  const rawParts = formData.getAll('parts');
  const partsProvided = formData.get('partsProvided') === 'true';

  const parsed: Array<{ partCatalogItemId: string; action: 'REPLACED' | 'REPAIRED'; quantity: number }> = [];
  if (partsProvided) {
    for (const raw of rawParts) {
      const [action, partCatalogItemId, qty] = String(raw).split(':');
      if (action !== 'REPLACED' && action !== 'REPAIRED') continue;
      if (!partCatalogItemId) continue;
      const quantity = Number(qty);
      if (!Number.isFinite(quantity) || quantity < 1) continue;
      parsed.push({ partCatalogItemId, action, quantity });
    }

    // Same catalogue guard the technician's submit path applies: the SMD strips are cut
    // in whole 50 cm steps and nothing may exceed its unit's ceiling.
    if (parsed.length) {
      const catalogue = await prisma.partCatalogItem.findMany({
        where: { id: { in: parsed.map((p) => p.partCatalogItemId) } },
        select: { id: true, unit: true, quantityStep: true },
      });
      const byId = new Map(catalogue.map((c) => [c.id, c]));
      for (const entry of parsed) {
        const item = byId.get(entry.partCatalogItemId);
        if (!item) return { error: 'generic' };
        const step = Math.max(1, item.quantityStep);
        const max = item.unit === 'CENTIMETER' ? 5000 : 99;
        if (entry.quantity % step !== 0 || entry.quantity > max) {
          return { error: 'invalidQuantity' };
        }
      }
    }
  }

  const cityId = text('cityId') ?? existing.cityId;
  const city = cityId ? await prisma.city.findUnique({ where: { id: cityId } }) : null;

  await prisma.$transaction(async (tx) => {
    if (partsProvided) {
      await tx.partUsage.deleteMany({ where: { repairFormId: formId } });
      // Merge duplicates so the (form, part, action) unique constraint cannot trip.
      const merged = new Map<string, (typeof parsed)[number]>();
      for (const entry of parsed) {
        const key = `${entry.partCatalogItemId}:${entry.action}`;
        const prev = merged.get(key);
        if (prev) prev.quantity += entry.quantity;
        else merged.set(key, { ...entry });
      }
      if (merged.size) {
        await tx.partUsage.createMany({
          data: [...merged.values()].map((entry) => ({
            repairFormId: formId,
            partCatalogItemId: entry.partCatalogItemId,
            action: entry.action,
            quantity: entry.quantity,
          })),
        });
      }
    }

    // §6.1 — the outcome is always derived from the parts, never chosen, on edit as on
    // submit. An edit that removes every part turns the visit into an unsuccessful one.
    const partCount = partsProvided
      ? parsed.length
      : await tx.partUsage.count({ where: { repairFormId: formId } });
    const outcome = partCount > 0 ? 'REPAIRED' : 'NOT_REPAIRED';

    const reason = text('notRepairedReason');
    if (outcome === 'NOT_REPAIRED' && !reason && !existing.notRepairedReason) {
      throw new Error('REASON_REQUIRED');
    }

    // §6.6 — re-price from the edited date/city/outcome so a correction cannot leave a
    // wage that no longer matches the form it belongs to.
    const wage = await computeWage({
      technicianId: existing.technicianId,
      storeId: existing.storeId,
      standId: existing.standId,
      isTehran: city?.isTehran ?? false,
      outcome,
      date,
      excludeFormId: formId,
      db: tx,
    });

    await tx.repairForm.update({
      where: { id: formId },
      data: {
        date,
        cityId,
        storeName: text('storeName'),
        storeAddress: text('storeAddress'),
        storeManagerName: text('storeManagerName'),
        storePhone: text('storePhone'),
        digitalAddress: text('digitalAddress'),
        timeSpentMinutes: num('timeSpentMinutes'),
        qualityScore: outcome === 'REPAIRED' ? quality : null,
        notes: text('notes'),
        outcome,
        notRepairedReason:
          outcome === 'NOT_REPAIRED'
            ? ((reason ?? existing.notRepairedReason) as never)
            : null,
        wageAmount: wage.amount,
        wageTier: wage.tier,
        wageRateApplied: wage.rate,
      },
    });
  });

  revalidateForm(locale);
  return { ok: 'formSaved' };
}
