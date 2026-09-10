import 'server-only';

import type { NotRepairedReason, PartAction, PhotoType, Prisma } from '@prisma/client';

import { nextFormCode } from './codes';
import { requiredStandPhotos } from './photo-rules';
import { DAY_MS, RE_REPAIR_WINDOW_DAYS } from './dates';
import { prisma } from './prisma';
import { resolveCityId as resolveCityByName } from './cities';
import { resolveProjectForUid } from './projects';
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
  /** The store's Jti uid. Shared by every stand at that location. */
  uid: string;
  /** Which stand at that location, 1-based. Defaults to the first. */
  standIndex?: number;
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

  // The uid names a location. Its stands come back in position order so the technician
  // sees "this store has 3 stands" and reports on each of them in one visit.
  const store = await prisma.store.findUnique({
    where: { uid },
    include: {
      city: true,
      stands: { orderBy: { standIndexAtStore: 'asc' } },
    },
  });

  // Most recent order row carrying metadata for this uid — this is what pre-fills the
  // store fields when the location is not on file yet.
  const orderLine = await prisma.orderLine.findFirst({
    where: { uid, status: { not: 'EXCLUDED' } },
    orderBy: { createdAt: 'desc' },
    include: { batch: { select: { name: true, importedAt: true, source: true } } },
  });

  // History is per uid: every form ever filed at this location, whichever stand.
  const history = await prisma.repairForm.findMany({
    where: { uid },
    orderBy: { date: 'desc' },
    include: {
      technician: { select: { name: true, technicianCode: true } },
      city: true,
      parts: { include: { part: true } },
    },
  });

  const { projectId } = await resolveProjectForUid(prisma, uid);

  // Re-repair is tracked per stand (client ruling): stand 2 being repaired twice in this
  // campaign is a re-repair, while stand 3's first repair is not. Map the stand positions
  // already repaired in this project so the form can warn per stand.
  const repairedThisProjectByStand = new Map<number, (typeof history)[number]>();
  for (const form of history) {
    if (form.outcome !== 'REPAIRED' || form.projectId !== projectId) continue;
    if (!repairedThisProjectByStand.has(form.standIndex)) {
      repairedThisProjectByStand.set(form.standIndex, form);
    }
  }

  const lastRepaired = history.find((f) => f.outcome === 'REPAIRED') ?? null;
  const hasPreviousProjectHistory = history.some(
    (f) => f.outcome === 'REPAIRED' && f.projectId !== projectId,
  );

  return {
    uid,
    store,
    /** Stands already on file at this location, in position order. */
    stands: store?.stands ?? [],
    /** How many stands the technician should expect to find. At least one. */
    standCount: Math.max(1, store?.stands.length ?? 0),
    orderLine,
    /** §4.3 — no import row anywhere: the form will be flagged unmatched. */
    isUnmatched: !orderLine,
    /** §6.2 — added outside the official order and not yet confirmed by a manager. */
    isPendingConfirmation: store?.confirmation === 'PENDING',
    history,
    lastRepaired,
    /** standIndex -> the earlier form in THIS project, if any. */
    repairedThisProjectByStand,
    /** Repaired in an earlier campaign — shown as history, never as a re-repair. */
    hasPreviousProjectHistory,
    prefill: {
      storeName: store?.name ?? orderLine?.storeName ?? '',
      storeAddress: store?.address ?? orderLine?.address ?? '',
      storeManagerName: store?.managerName ?? orderLine?.managerName ?? '',
      storePhone: store?.phone ?? orderLine?.phone ?? '',
      digitalAddress: store?.digitalAddress ?? orderLine?.digitalAddress ?? '',
      cityId: store?.cityId ?? null,
      cityName: store?.city.name ?? orderLine?.cityName ?? '',
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
  // Delegated so an English city name matches the Persian row instead of creating a
  // second city (see lib/cities.ts).
  return resolveCityByName(tx, cityName);
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

  // Quantities are validated against the catalogue, not trusted from the client: the
  // SMD strips are cut to length and must arrive as whole 50 cm steps, while everything
  // else is a discrete piece. The picker already enforces this, so a violation means a
  // tampered or buggy request — reject it rather than silently snapping a number that
  // ends up on a parts bill.
  if (parts.length) {
    const catalogue = await prisma.partCatalogItem.findMany({
      where: { id: { in: parts.map((p) => p.partCatalogItemId) } },
      select: { id: true, unit: true, quantityStep: true },
    });
    const byId = new Map(catalogue.map((c) => [c.id, c]));

    for (const entry of parts) {
      const item = byId.get(entry.partCatalogItemId);
      if (!item) throw new RepairFormError('UNKNOWN_PART');

      const step = Math.max(1, item.quantityStep);
      const max = item.unit === 'CENTIMETER' ? 5000 : 99;
      if (entry.quantity % step !== 0 || entry.quantity > max) {
        throw new RepairFormError('INVALID_QUANTITY');
      }
    }
  }

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

  // §4.4 — the store photo proves the visit and is always required. The stand's own
  // photos depend on the outcome: there is no "after" when nothing was repaired, and no
  // "before" either when the stand was gone or the shop was shut. See lib/photo-rules.ts.
  const requiredPhotos: PhotoType[] = [
    'STORE',
    ...requiredStandPhotos(outcome, input.notRepairedReason),
  ];
  for (const required of requiredPhotos) {
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

      const cityId = await resolveCityId(
        tx,
        input.cityId,
        orderLine?.cityName ?? undefined,
      );

      // --- Store (the location the uid names) -----------------------------------
      // Editing the pre-filled fields is how technicians correct stale Jti data, so
      // non-blank values are written back. Blank fields never erase what we already have.
      const storeName = input.storeName?.trim();
      const storeData = {
        ...(storeName ? { name: storeName, matchKey: makeStoreMatchKey(storeName) } : {}),
        ...(input.storeAddress?.trim() ? { address: input.storeAddress.trim() } : {}),
        ...(input.storeManagerName?.trim()
          ? { managerName: input.storeManagerName.trim() }
          : {}),
        ...(input.storePhone?.trim() ? { phone: input.storePhone.trim() } : {}),
        ...(input.digitalAddress?.trim()
          ? { digitalAddress: input.digitalAddress.trim() }
          : {}),
        ...(cityId ? { cityId } : {}),
      };

      let store = await tx.store.findUnique({ where: { uid } });

      if (!store) {
        if (!cityId) throw new RepairFormError('CITY_REQUIRED');
        // §6.2 — a uid nobody ordered. The technician may still file the report, but the
        // location stays PENDING until a manager admits it to the official record.
        store = await tx.store.create({
          data: {
            uid,
            name: storeName || uid,
            matchKey: makeStoreMatchKey(storeName || uid),
            cityId,
            address: input.storeAddress?.trim() || null,
            managerName: input.storeManagerName?.trim() || null,
            phone: input.storePhone?.trim() || null,
            digitalAddress: input.digitalAddress?.trim() || null,
            confirmation: orderLine ? 'CONFIRMED' : 'PENDING',
            createdById: input.technicianId,
          },
        });
      } else if (Object.keys(storeData).length) {
        store = await tx.store.update({ where: { id: store.id }, data: storeData });
      }

      const storeId = store.id;

      // --- Stand (a position at that location) ----------------------------------
      // Stands share their store's uid, so position is their identity. Upserting on
      // (storeId, index) means a store quietly grows from one stand to three the first
      // time a technician reports on the extra ones.
      const standIndex = Math.max(1, Math.floor(input.standIndex ?? 1));
      const stand = await tx.stand.upsert({
        where: { storeId_standIndexAtStore: { storeId, standIndexAtStore: standIndex } },
        create: { storeId, standIndexAtStore: standIndex },
        update: {},
      });

      // --- Project scope --------------------------------------------------------
      const { projectId, phaseId } = await resolveProjectForUid(tx, uid);

      // --- §6.3 re-repair detection (revised) ------------------------------------
      // The PROJECT is what defines a re-repair, not elapsed time: the same stand
      // repaired twice inside one campaign is a re-repair however far apart the visits
      // fall, while the same stand repaired in a later campaign is normal recurring
      // work and belongs in the main export.
      //
      // Only a *repair* can be a re-repair — an unsuccessful revisit is just an
      // unsuccessful visit.
      let isReRepair = false;
      let isQuickReRepair = false;
      let previousFormId: string | null = null;
      let hasPreviousProjectHistory = false;

      if (outcome === 'REPAIRED') {
        const previousInProject = projectId
          ? await tx.repairForm.findFirst({
              where: {
                // Per stand, not per uid: stand 2 coming back is a re-repair, while
                // stand 3's first repair at the same location is not.
                standId: stand.id,
                outcome: 'REPAIRED',
                projectId,
                date: { lte: date },
              },
              orderBy: { date: 'desc' },
              select: { id: true, date: true },
            })
          : null;

        if (previousInProject) {
          isReRepair = true;
          previousFormId = previousInProject.id;
          // 14 days is now only a quality signal on the re-repair page: a stand that
          // failed again this fast is a different problem from one that lasted months.
          isQuickReRepair =
            date.getTime() - previousInProject.date.getTime() <=
            RE_REPAIR_WINDOW_DAYS * DAY_MS;
        }

        // Serviced in an EARLIER campaign: worth surfacing to the manager, but
        // deliberately not a re-repair of this one, so the row stays in the main export.
        //
        // `{ not: projectId }` alone would silently drop rows whose projectId is NULL
        // (SQL `<>` is never true against NULL), so unassigned historical repairs are
        // matched explicitly.
        const earlierProject = await tx.repairForm.findFirst({
          where: {
            standId: stand.id,
            outcome: 'REPAIRED',
            ...(projectId
              ? { OR: [{ projectId: null }, { projectId: { not: projectId } }] }
              : {}),
          },
          select: { id: true },
        });
        hasPreviousProjectHistory = !!earlierProject;
      }

      // --- Wage (§6.6) ----------------------------------------------------------
      // Fall back to the location's own city: a technician who leaves the city select
      // untouched must still be paid at the right rate.
      const effectiveCityId = cityId ?? store.cityId;
      const city = await tx.city.findUnique({ where: { id: effectiveCityId } });
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
          cityId: effectiveCityId,
          storeId,

          uid,
          standIndex,

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

          projectId,
          phaseId,

          isReRepair,
          previousFormId,
          isQuickReRepair,
          hasPreviousProjectHistory,
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
        data: { status: 'DONE', storeId },
      });

      return { form, store, stand, isReRepair, outcome, wage };
    },
    { timeout: 20_000 },
  );
}
