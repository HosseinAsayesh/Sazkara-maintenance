'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireActionManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { normaliseUid } from '@/lib/text';

export interface ActionState {
  error?: string;
  ok?: string;
}

/**
 * Editing and deleting an imported Jti order.
 *
 * Jti's spreadsheets arrive with wrong phone numbers, merged store names and stray rows,
 * and until now the only fix was to re-import the whole file. These actions let the
 * manager correct a row in place, drop a row, or delete an order outright.
 *
 * The one thing they will not do is destroy evidence: a row that a technician has
 * already filed a report against is kept, and an order with any submitted report cannot
 * be deleted. Order rows are the *request*; repair forms are the *record*, and the record
 * has to survive edits to the request.
 */

function revalidateOrders(locale: string, batchId?: string) {
  revalidatePath(`/${locale}/manager/imports`);
  if (batchId) revalidatePath(`/${locale}/manager/imports/${batchId}`);
  revalidatePath(`/${locale}/manager`, 'layout');
}

export async function updateOrderLineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const lineId = String(formData.get('lineId') ?? '');
  if (!lineId) return { error: 'generic' };

  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { id: true, batchId: true, uid: true },
  });
  if (!line) return { error: 'notFound' };

  const uid = normaliseUid(String(formData.get('uid') ?? ''));
  if (!uid) return { error: 'uidRequired' };

  // The (batch, uid) pair is unique — catch a rename onto an existing row before the
  // database does, so the manager gets a message instead of a constraint error.
  if (uid !== line.uid) {
    const clash = await prisma.orderLine.findUnique({
      where: { batchId_uid: { batchId: line.batchId, uid } },
    });
    if (clash) return { error: 'duplicateUid' };
  }

  const text = (key: string) => {
    const value = String(formData.get(key) ?? '').trim();
    return value || null;
  };

  await prisma.orderLine.update({
    where: { id: lineId },
    data: {
      uid,
      storeName: text('storeName'),
      address: text('address'),
      digitalAddress: text('digitalAddress'),
      managerName: text('managerName'),
      phone: text('phone'),
      cityName: text('cityName'),
    },
  });

  revalidateOrders(locale, line.batchId);
  return { ok: 'lineSaved' };
}

export async function deleteOrderLineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const lineId = String(formData.get('lineId') ?? '');
  if (!lineId) return { error: 'generic' };

  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { id: true, batchId: true, uid: true, status: true },
  });
  if (!line) return { error: 'notFound' };

  // A row a technician has already worked is history, not a pending request.
  const reported = await prisma.repairForm.findFirst({
    where: { uid: line.uid },
    select: { id: true },
  });
  if (reported) return { error: 'lineHasForms' };

  await prisma.orderLine.delete({ where: { id: lineId } });
  revalidateOrders(locale, line.batchId);
  return { ok: 'success' };
}

export async function addOrderLineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const batchId = String(formData.get('batchId') ?? '');
  const uid = normaliseUid(String(formData.get('uid') ?? ''));

  if (!batchId) return { error: 'generic' };
  if (!uid) return { error: 'uidRequired' };

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { error: 'notFound' };

  const clash = await prisma.orderLine.findUnique({
    where: { batchId_uid: { batchId, uid } },
  });
  if (clash) return { error: 'duplicateUid' };

  const text = (key: string) => {
    const value = String(formData.get(key) ?? '').trim();
    return value || null;
  };

  // §6.4 — a manually added row gets the same "already serviced" check as an imported
  // one, so the manager sees the history before committing to the work.
  const previous = await prisma.repairForm.findFirst({
    where: { uid, outcome: 'REPAIRED' },
    orderBy: { date: 'desc' },
    select: { date: true, city: { select: { name: true } } },
  });

  await prisma.orderLine.create({
    data: {
      batchId,
      uid,
      storeName: text('storeName'),
      address: text('address'),
      digitalAddress: text('digitalAddress'),
      managerName: text('managerName'),
      phone: text('phone'),
      cityName: text('cityName'),
      isDuplicate: !!previous,
      duplicateNote: previous
        ? `${previous.date.toISOString().slice(0, 10)}${
            previous.city?.name ? ` — ${previous.city.name}` : ''
          }`
        : null,
    },
  });

  revalidateOrders(locale, batchId);
  return { ok: 'success' };
}

/**
 * Delete an imported order.
 *
 * Two things this must get right:
 *
 *  1. The caller is standing on /manager/imports/<id>, which is about to stop existing.
 *     Revalidating that path re-renders it, `findUnique` returns null and notFound()
 *     fires — a successful delete used to look like a 404. It redirects to the order list
 *     instead, carrying the name so that page can confirm what happened.
 *
 *  2. It no longer refuses outright when technicians have filed against the order. The
 *     manager needs to retire a wrong or finished order regardless. What it will NOT do
 *     is take the reports with it: an order row is a REQUEST for work, a repair form is
 *     the RECORD of work actually done, complete with photos and signatures. The forms
 *     survive with their uid history intact and stay in every export and statistic; only
 *     the request disappears. Deleting a report is a separate, per-report act.
 */
export async function deleteOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const batchId = String(formData.get('batchId') ?? '');
  const force = String(formData.get('force') ?? '') === 'true';
  const alsoDeleteForms = String(formData.get('deleteForms') ?? '') === 'true';
  if (!batchId) return { error: 'generic' };

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, name: true, lines: { select: { uid: true } } },
  });
  if (!batch) return { error: 'notFound' };

  const uids = batch.lines.map((l) => l.uid);
  const reported = uids.length
    ? await prisma.repairForm.count({ where: { uid: { in: uids } } })
    : 0;

  // Fieldwork attached means a second, explicit confirmation — never a silent removal.
  if (reported > 0 && !force) return { error: 'cannotDeleteWithForms' };

  let removedForms = 0;

  if (alsoDeleteForms && uids.length) {
    // Opt-in only. Keeping the reports leaves them counted on the dashboard and in every
    // export, which is right when an order is merely retired and wrong when it was
    // imported by mistake — so the manager says which case this is.
    const forms = await prisma.repairForm.findMany({
      where: { uid: { in: uids } },
      select: {
        id: true,
        technicianSignature: true,
        storeManagerSignature: true,
        photos: { select: { fileRef: true } },
      },
    });
    const formIds = forms.map((f) => f.id);
    removedForms = formIds.length;

    await prisma.$transaction(
      async (tx) => {
        await tx.partUsage.deleteMany({ where: { repairFormId: { in: formIds } } });
        await tx.photo.deleteMany({ where: { repairFormId: { in: formIds } } });
        await tx.repairForm.deleteMany({ where: { id: { in: formIds } } });
        await tx.importBatch.delete({ where: { id: batchId } });

        // Stores and stands go only once nothing at all references the uid.
        for (const uid of uids) {
          const stillUsed =
            (await tx.repairForm.count({ where: { uid } })) +
            (await tx.orderLine.count({ where: { uid } }));
          if (stillUsed === 0) {
            await tx.stand.deleteMany({ where: { store: { uid } } });
            await tx.store.deleteMany({ where: { uid } });
          }
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    // Files last: a rolled-back transaction must never leave dangling references.
    const storage = getStorage();
    const refs = forms
      .flatMap((f) => [
        ...f.photos.map((p) => p.fileRef),
        f.technicianSignature,
        f.storeManagerSignature,
      ])
      .filter((r): r is string => !!r);
    await Promise.all(refs.map((ref) => storage.delete(ref).catch(() => {})));
  } else {
    // Lines cascade with the batch (see the schema relation). Repair forms do not
    // reference OrderLine, so they are untouched by this.
    await prisma.importBatch.delete({ where: { id: batchId } });
  }

  revalidateOrders(locale);

  const query = new URLSearchParams({ deleted: batch.name });
  if (alsoDeleteForms) query.set('removedForms', String(removedForms));
  else if (reported > 0) query.set('keptForms', String(reported));

  redirect(`/${locale}/manager/imports?${query.toString()}`);
}

/** Move an order into a different project/phase after the fact. */
export async function assignOrderProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const batchId = String(formData.get('batchId') ?? '');
  const projectId = String(formData.get('projectId') ?? '') || null;
  const phaseId = String(formData.get('phaseId') ?? '') || null;
  if (!batchId) return { error: 'generic' };

  // A phase belonging to another project would make the batch unreachable from both.
  if (phaseId) {
    const phase = await prisma.phase.findUnique({ where: { id: phaseId } });
    if (!phase || phase.projectId !== projectId) return { error: 'phaseMismatch' };
  }

  await prisma.importBatch.update({
    where: { id: batchId },
    data: { projectId, phaseId },
  });

  revalidateOrders(locale, batchId);
  return { ok: 'success' };
}
