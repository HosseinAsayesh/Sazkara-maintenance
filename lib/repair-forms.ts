import 'server-only';

import type { NotRepairedReason, PartAction, PhotoType, Prisma } from '@prisma/client';

import { nextFormCode } from './codes';
import { DAY_MS, RE_REPAIR_WINDOW_DAYS } from './dates';
import { prisma } from './prisma';
import { makeStoreMatchKey, normaliseUid } from './text';
import { computeWage } from './wages';

export interface PartEntryInput {
  partCatalogItemId: string;
  action: PartAction;
  quantity: number;
}

export interface PhotoInput {
  type: PhotoType;
  fileRef: string;
}

export interface CreateRepairFormInput {
  uid: string;
  technicianId: string;
  date?: Date;

  cityId?: string | null;
  storeName?: string;
  storeAddress?: string;
  storeManagerName?: string;
  storePhone?: string;
  digitalAddress?: string;

  parts: PartEntryInput[];
  notRepairedReason?: NotRepairedReason | null;

  qualityScore?: number | null;
  timeSpentMinutes?: number | null;
  notes?: string | null;

  technicianSignature?: string;
  storeManagerSignature?: string;
  photos: PhotoInput[];
}

export class RepairFormError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Look up everything the technician's form screen needs for a uid, before they fill it
 * in: the stand (if known), the store metadata pre-filled from the most recent import
 * row, and the stand's full repair history (§4.3, §6.7).
 */
export async function lookupUid(uidRaw: string) {
  const uid = normaliseUid(uidRaw);
  if (!uid) throw new RepairFormError('UID_REQUIRED');

  const stand = await prisma.stand.findUnique({
    where: { uid },
    include: {
      store: { include: { city: true } },
      repairForms: {
        orderBy: { date: 'desc' },
        include: {
          technician: { select: { name: true, technicianCode: true } },
          city: true,
          parts: { include: { part: true } },
        },
      },
    },
  });

  // Most recent order row carrying metadata for this uid — this is what pre-fills the
  // store fields when the stand itself has no store attached yet.
  const orderLine = await prisma.orderLine.findFirst({
    where: { uid, status: { not: 'EXCLUDED' } },
    orderBy: { createdAt: 'desc' },
    include: { batch: { select: { name: true, importedAt: true, source: true } } },
  });

  const lastRepaired = stand?.repairForms.find((f) => f.outcome === 'REPAIRED') ?? null;
  const wouldBeReRepair =
    !!lastRepaired &&
    Date.now() - lastRepaired.date.getTime() <= RE_REPAIR_WINDOW_DAYS * DAY_MS;

  return {
    uid,
    stand,
    orderLine,
    /** §4.3 — no import row anywhere: the form will be flagged unmatched. */
    isUnmatched: !orderLine,
    /** §6.2 — added outside the official order and not yet confirmed by a manager. */
    isPendingConfirmation: stand?.confirmation === 'PENDING',
    history: stand?.repairForms ?? [],
    lastRepaired,
    wouldBeReRepair,
    prefill: {
      storeName: stand?.store?.name ?? orderLine?.storeName ?? '',
      storeAddress: stand?.store?.address ?? orderLine?.address ?? '',
      storeManagerName: stand?.store?.managerName ?? orderLine?.managerName ?? '',
      storePhone: stand?.store?.phone ?? orderLine?.phone ?? '',
      digitalAddress: stand?.store?.digitalAddress ?? orderLine?.digitalAddress ?? '',
      cityId: stand?.store?.cityId ?? null,
      cityName: stand?.store?.city.name ?? orderLine?.cityName ?? '',
    },
  };
}

/** Resolve (or create) the City a form belongs to. */
async function resolveCityId(
  tx: Prisma.TransactionClient,
  cityId: string | null | undefined,
  cityName: string | null | undefined,
): Promise<string | null> {
  if (cityId) return cityId;
  const name = cityName?.trim();
  if (!name) return null;

  const existing = await tx.city.findFirst({ where: { name } });
  if (existing) return existing.id;

  const created = await tx.city.create({
    data: { name, isTehran: makeStoreMatchKey(name) === makeStoreMatchKey('تهران') },
  });
  return created.id;
}

/**
 * Submit a technician's repair form.
 *
 * Implements §6.1 (outcome is derived, never chosen), §6.2 (unknown uids land in
 * pending confirmation), §6.3 (re-repair detection) and §6.6 (wage tier), and closes out
 * the matching order lines.
 */
export async function createRepairForm(input: CreateRepairFormInput) {
  const uid = normaliseUid(input.uid);
  if (!uid) throw new RepairFormError('UID_REQUIRED');

  // Merge duplicates so a client that sends the same part twice can't trip the
  // (form, part, action) unique constraint mid-transaction.
  const merged = new Map<string, PartEntryInput>();
  for (const p of input.parts) {
    if (!p.partCatalogItemId || p.quantity <= 0) continue;
    const key = `${p.partCatalogItemId}:${p.action}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += p.quantity;
    else merged.set(key, { ...p });
  }
  const parts = [...merged.values()];

  // §6.1 — a stand counts as repaired if at least one part was replaced OR repaired.
  // The technician never picks the outcome directly.
  const outcome = parts.length > 0 ? 'REPAIRED' : 'NOT_REPAIRED';

  if (outcome === 'NOT_REPAIRED' && !input.notRepairedReason) {
    throw new RepairFormError('REASON_REQUIRED');
  }
  if (outcome === 'REPAIRED' && (input.qualityScore == null || input.qualityScore < 0)) {
    throw new RepairFormError('QUALITY_REQUIRED');
  }
  if (input.qualityScore != null && (input.qualityScore < 0 || input.qualityScore > 5)) {
    throw new RepairFormError('QUALITY_OUT_OF_RANGE');
  }
  if (!input.technicianSignature || !input.storeManagerSignature) {
    throw new RepairFormError('SIGNATURES_REQUIRED');
  }

  // §4.4 — store photo + before + after are all required; extras are allowed.
  for (const required of ['STORE', 'BEFORE', 'AFTER'] as const) {
    if (!input.photos.some((p) => p.type === required)) {
      throw new RepairFormError('PHOTOS_REQUIRED');
    }
  }

  const date = input.date ?? new Date();

  return prisma.$transaction(
    async (tx) => {
      const orderLine = await tx.orderLine.findFirst({
        where: { uid, status: { not: 'EXCLUDED' } },
        orderBy: { createdAt: 'desc' },
      });

      let stand = await tx.stand.findUnique({ where: { uid } });

      const cityId = await resolveCityId(
        tx,
        input.cityId,
        orderLine?.cityName ?? undefined,
      );

      // --- Store resolution -----------------------------------------------------
      // Editing the pre-filled store fields is how technicians correct stale Jti data,
      // so non-blank values are written back to the Store record. Blank fields never
      // erase what we already have.
      let storeId = stand?.storeId ?? null;
      const storeName = input.storeName?.trim();

      if (!storeId && storeName && cityId) {
        const matchKey = makeStoreMatchKey(storeName);
        const store = await tx.store.upsert({
          where: { cityId_matchKey: { cityId, matchKey } },
          create: {
            name: storeName,
            matchKey,
            cityId,
            address: input.storeAddress?.trim() || null,
            managerName: input.storeManagerName?.trim() || null,
            phone: input.storePhone?.trim() || null,
            digitalAddress: input.digitalAddress?.trim() || null,
          },
          update: {},
        });
        storeId = store.id;
      } else if (storeId) {
        await tx.store.update({
          where: { id: storeId },
          data: {
            ...(storeName ? { name: storeName, matchKey: makeStoreMatchKey(storeName) } : {}),
            ...(input.storeAddress?.trim() ? { address: input.storeAddress.trim() } : {}),
            ...(input.storeManagerName?.trim()
              ? { managerName: input.storeManagerName.trim() }
              : {}),
            ...(input.storePhone?.trim() ? { phone: input.storePhone.trim() } : {}),
            ...(input.digitalAddress?.trim()
              ? { digitalAddress: input.digitalAddress.trim() }
              : {}),
          },
        });
      }

      // --- Stand ----------------------------------------------------------------
      if (!stand) {
        // §6.2 — a uid nobody ordered. The technician may still file the report, but
        // the stand stays PENDING until a manager admits it to the official record.
        const siblings = storeId
          ? await tx.stand.count({ where: { storeId } })
          : 0;

        stand = await tx.stand.create({
          data: {
            uid,
            storeId,
            standIndexAtStore: siblings + 1,
            confirmation: orderLine ? 'CONFIRMED' : 'PENDING',
            createdById: input.technicianId,
          },
        });
      } else if (!stand.storeId && storeId) {
        const siblings = await tx.stand.count({ where: { storeId } });
        stand = await tx.stand.update({
          where: { id: stand.id },
          data: { storeId, standIndexAtStore: siblings + 1 },
        });
      }

      // --- §6.3 re-repair detection --------------------------------------------
      // Only a *repair* can be a re-repair: an unsuccessful visit inside the window is
      // just an unsuccessful visit.
      let isReRepair = false;
      let previousFormId: string | null = null;

      if (outcome === 'REPAIRED') {
        const previous = await tx.repairForm.findFirst({
          where: {
            standId: stand.id,
            outcome: 'REPAIRED',
            date: { gte: new Date(date.getTime() - RE_REPAIR_WINDOW_DAYS * DAY_MS), lte: date },
          },
          orderBy: { date: 'desc' },
          select: { id: true },
        });
        if (previous) {
          isReRepair = true;
          previousFormId = previous.id;
        }
      }

      // --- Wage (§6.6) ----------------------------------------------------------
      const city = cityId ? await tx.city.findUnique({ where: { id: cityId } }) : null;
      const wage = await computeWage({
        technicianId: input.technicianId,
        storeId,
        standId: stand.id,
        isTehran: city?.isTehran ?? false,
        outcome,
        date,
        db: tx,
      });

      const formCode = await nextFormCode(tx);

      const form = await tx.repairForm.create({
        data: {
          formCode,
          standId: stand.id,
          technicianId: input.technicianId,
          cityId,
          storeId,

          storeName: storeName || null,
          storeAddress: input.storeAddress?.trim() || null,
          storeManagerName: input.storeManagerName?.trim() || null,
          storePhone: input.storePhone?.trim() || null,
          digitalAddress: input.digitalAddress?.trim() || null,

          date,
          timeSpentMinutes: input.timeSpentMinutes ?? null,
          qualityScore: outcome === 'REPAIRED' ? (input.qualityScore ?? null) : null,
          notes: input.notes?.trim() || null,

          technicianSignature: input.technicianSignature,
          storeManagerSignature: input.storeManagerSignature,

          outcome,
          notRepairedReason: outcome === 'NOT_REPAIRED' ? input.notRepairedReason : null,

          isReRepair,
          previousFormId,
          isUnmatched: !orderLine,

          wageAmount: wage.amount,
          wageTier: wage.tier,
          wageRateApplied: wage.rate,

          parts: {
            create: parts.map((p) => ({
              partCatalogItemId: p.partCatalogItemId,
              action: p.action,
              quantity: p.quantity,
            })),
          },
          photos: {
            create: input.photos.map((photo, index) => ({
              type: photo.type,
              fileRef: photo.fileRef,
              index,
            })),
          },
        },
      });

      // Close out every outstanding order row for this uid, whichever batch it sits in.
      await tx.orderLine.updateMany({
        where: { uid, status: 'PENDING' },
        data: { status: 'DONE', standId: stand.id },
      });

      return { form, stand, isReRepair, outcome, wage };
    },
    { timeout: 20_000 },
  );
}
