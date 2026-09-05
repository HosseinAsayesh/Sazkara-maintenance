import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { getStorage } from './storage';
import { makeStoreMatchKey } from './text';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * City identity, in one place.
 *
 * Cities used to be created from four independent code paths (order import, historical
 * import, technician submit, manager settings), each matching on an exact name string.
 * That is how a database ends up holding both `تهران` and `Tehran` as separate cities:
 * a sheet with the English spelling in its city column created a second row, splitting
 * that city's stores, forms and — because Tehran is its own wage bucket (§6.6) — its
 * payroll reporting.
 *
 * Everything now resolves through `resolveCityId`, which matches on a normalised key
 * against BOTH the Persian name and the English `nameEn` alias.
 */

/** Persian/Arabic character variants, digits and spacing all folded away. */
export function cityKey(name: string): string {
  return makeStoreMatchKey(name);
}

/** Spellings that mean Tehran, so the §6.6 wage flag is set on creation. */
const TEHRAN_KEYS = new Set([cityKey('تهران'), cityKey('Tehran'), cityKey('tehran')]);

export function looksLikeTehran(name: string): boolean {
  return TEHRAN_KEYS.has(cityKey(name));
}

/**
 * Find (or create) the city a name refers to.
 *
 * Matching is on the normalised name OR the normalised English alias, so "Tehran",
 * "تهران" and "تهــران " all land on the same row. Only a genuinely unknown name creates
 * one, and it inherits the Tehran wage flag when the name says Tehran.
 */
export async function resolveCityId(
  db: Db,
  rawName: string | null | undefined,
): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;

  const key = cityKey(name);
  if (!key) return null;

  // The city table is tiny (tens of rows), so an in-memory match is cheaper and far more
  // forgiving than trying to express this normalisation in SQL.
  const all = await db.city.findMany({ select: { id: true, name: true, nameEn: true } });
  const hit = all.find(
    (c) => cityKey(c.name) === key || (c.nameEn ? cityKey(c.nameEn) === key : false),
  );
  if (hit) return hit.id;

  const created = await db.city.create({
    data: { name, isTehran: looksLikeTehran(name) },
  });
  return created.id;
}

export interface CityUsage {
  id: string;
  name: string;
  nameEn: string | null;
  isTehran: boolean;
  stores: number;
  forms: number;
  evidence: number;
  orderLines: number;
}

/** Every city with the reference counts a manager needs before merging or deleting one. */
export async function listCitiesWithUsage(): Promise<CityUsage[]> {
  const [cities, storeGroups, formGroups, evidenceGroups, orderLines] = await Promise.all([
    prisma.city.findMany({ orderBy: { name: 'asc' } }),
    prisma.store.groupBy({ by: ['cityId'], _count: { _all: true } }),
    prisma.repairForm.groupBy({ by: ['cityId'], _count: { _all: true } }),
    prisma.evidencePdfBatch.groupBy({ by: ['cityId'], _count: { _all: true } }),
    prisma.orderLine.groupBy({ by: ['cityName'], _count: { _all: true } }),
  ]);

  const storeBy = new Map(storeGroups.map((g) => [g.cityId, g._count._all]));
  const formBy = new Map(formGroups.map((g) => [g.cityId, g._count._all]));
  const evidenceBy = new Map(evidenceGroups.map((g) => [g.cityId, g._count._all]));

  // OrderLine keeps a city *name* snapshot rather than a foreign key, so it is counted by
  // normalised name.
  const lineBy = new Map<string, number>();
  for (const group of orderLines) {
    if (!group.cityName) continue;
    const key = cityKey(group.cityName);
    lineBy.set(key, (lineBy.get(key) ?? 0) + group._count._all);
  }

  return cities.map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.nameEn,
    isTehran: c.isTehran,
    stores: storeBy.get(c.id) ?? 0,
    forms: formBy.get(c.id) ?? 0,
    evidence: evidenceBy.get(c.id) ?? 0,
    orderLines: lineBy.get(cityKey(c.name)) ?? 0,
  }));
}

/**
 * Cities that normalise to the same key, or whose English alias collides with another
 * city's name — the pairs a manager should look at merging.
 */
export async function findDuplicateCityGroups(): Promise<CityUsage[][]> {
  const cities = await listCitiesWithUsage();
  const groups = new Map<string, CityUsage[]>();

  for (const city of cities) {
    // A city is grouped under its Persian key; the English alias is registered as a
    // second lookup so `Tehran` and `تهران` (nameEn "Tehran") meet.
    const keys = new Set([cityKey(city.name)]);
    if (city.nameEn) keys.add(cityKey(city.nameEn));

    let bucket: CityUsage[] | undefined;
    for (const key of keys) {
      const existing = groups.get(key);
      if (existing) {
        bucket = existing;
        break;
      }
    }
    if (!bucket) bucket = [];
    if (!bucket.includes(city)) bucket.push(city);
    for (const key of keys) groups.set(key, bucket);
  }

  return [...new Set(groups.values())].filter((g) => g.length > 1);
}

export class CityMergeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Fold `sourceId` into `targetId`: every store, form, cached evidence pack and order-line
 * snapshot moves across, then the source city is deleted.
 *
 * Stores cannot collide — since the uid refactor a Store is keyed by its globally unique
 * `uid`, not by (city, name). The one constraint that can collide is
 * `EvidencePdfBatch(cityId, date)`: if both cities cached a pack for the same day, the
 * target's is authoritative and the source's row and file are discarded, because the pack
 * is a derived artefact that can be regenerated.
 */
export async function mergeCities(sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new CityMergeError('SAME_CITY');

  const [source, target] = await Promise.all([
    prisma.city.findUnique({ where: { id: sourceId } }),
    prisma.city.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) throw new CityMergeError('NOT_FOUND');

  const discardedRefs: string[] = [];

  const moved = await prisma.$transaction(async (tx) => {
    // Evidence packs first, so the unique (city, date) pair is clear before the bulk move.
    const sourcePacks = await tx.evidencePdfBatch.findMany({ where: { cityId: sourceId } });
    const targetDates = new Set(
      (
        await tx.evidencePdfBatch.findMany({
          where: { cityId: targetId },
          select: { date: true },
        })
      ).map((p) => p.date.getTime()),
    );

    for (const pack of sourcePacks) {
      if (targetDates.has(pack.date.getTime())) {
        discardedRefs.push(pack.fileRef);
        await tx.evidencePdfBatch.delete({ where: { id: pack.id } });
      } else {
        await tx.evidencePdfBatch.update({
          where: { id: pack.id },
          data: { cityId: targetId },
        });
        targetDates.add(pack.date.getTime());
      }
    }

    const stores = await tx.store.updateMany({
      where: { cityId: sourceId },
      data: { cityId: targetId },
    });
    const forms = await tx.repairForm.updateMany({
      where: { cityId: sourceId },
      data: { cityId: targetId },
    });
    // The order-line snapshot is a plain string; realign it so future imports and the
    // outstanding-work counts group under the surviving name.
    const lines = await tx.orderLine.updateMany({
      where: { cityName: source.name },
      data: { cityName: target.name },
    });

    // Keep an English alias if the source carried one and the target does not — that is
    // usually exactly what the duplicate was.
    if (!target.nameEn && (source.nameEn || source.name !== target.name)) {
      await tx.city.update({
        where: { id: targetId },
        data: { nameEn: source.nameEn ?? source.name },
      });
    }

    // A city that is Tehran under either spelling stays Tehran for the wage split.
    if (source.isTehran && !target.isTehran) {
      await tx.city.update({ where: { id: targetId }, data: { isTehran: true } });
    }

    await tx.city.delete({ where: { id: sourceId } });

    return {
      stores: stores.count,
      forms: forms.count,
      orderLines: lines.count,
      evidenceMoved: sourcePacks.length - discardedRefs.length,
      evidenceDiscarded: discardedRefs.length,
    };
  });

  // Files last: had the transaction rolled back, these packs would still be referenced.
  const storage = getStorage();
  await Promise.all(discardedRefs.map((ref) => storage.delete(ref).catch(() => {})));

  return moved;
}

/** Deleting is only safe while nothing points at the city. */
export async function deleteCityIfUnused(cityId: string) {
  const [stores, forms, evidence] = await Promise.all([
    prisma.store.count({ where: { cityId } }),
    prisma.repairForm.count({ where: { cityId } }),
    prisma.evidencePdfBatch.count({ where: { cityId } }),
  ]);
  if (stores || forms || evidence) throw new CityMergeError('CITY_IN_USE');
  await prisma.city.delete({ where: { id: cityId } });
}
