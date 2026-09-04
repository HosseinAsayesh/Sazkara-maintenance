import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { endOfLocalDayExclusive, startOfLocalDay } from './dates';
import { getWageSettings, type WageSettings } from './settings';

/** Either the base client or an open transaction. */
type Db = Prisma.TransactionClient | typeof prisma;

/**
 * §6.6 — multi-stand ("double stand") wage calculation.
 *
 * The rule is about travel, not about the stand's identity: a technician earns the full
 * per-city rate for the FIRST stand they service at a store, and the reduced rate for
 * every additional stand serviced at that same store without travelling. So the tier is
 * derived from the order stands were actually serviced in — per technician, per store,
 * per Tehran-local day — not from `Stand.standIndexAtStore` (which is only the
 * catalogue ordinal, and would mis-price a second stand serviced on a different visit).
 *
 * Tehran has its own base rate; every other city shares one rate (§6.6).
 *
 * ASSUMPTION (stated in the README): a wage is earned on visits that resulted in a
 * repair, including re-repairs. A visit that produced no repair (store closed, owner
 * refused, ...) records a zero wage — nothing is billable to Jti for it. Flip
 * `PAY_UNREPAIRED_VISITS` if the client wants travel paid regardless.
 */
export const PAY_UNREPAIRED_VISITS = false;

export interface WageResult {
  /** 1 = first stand at this store today, 2 = second, 3+ = third or later. */
  tier: number;
  /** The rate that tier resolved to. */
  rate: number;
  amount: number;
}

export function rateForTier(
  tier: number,
  isTehran: boolean,
  settings: WageSettings,
): number {
  if (tier <= 1) return isTehran ? settings.tehranStandRate : settings.otherCityStandRate;
  if (tier === 2) return settings.secondStandRate;
  return settings.thirdPlusStandRate;
}

/**
 * How many *distinct other stands* at `storeId` this technician has already filed a paid
 * form for on `date`. The stand being priced is excluded: if a technician returns to a
 * stand they already serviced that day, that revisit is still the same stand and must
 * not be pushed into a lower tier by its own earlier visit.
 *
 * The next stand is therefore tier `count + 1`.
 *
 * `excludeFormId` lets a form be recalculated on edit without counting itself.
 */
async function priorStandsAtStoreToday(params: {
  technicianId: string;
  storeId: string;
  standId: string;
  date: Date;
  excludeFormId?: string;
  db: Db;
}): Promise<number> {
  const { technicianId, storeId, standId, date, excludeFormId, db } = params;

  const forms = await db.repairForm.findMany({
    where: {
      technicianId,
      storeId,
      standId: { not: standId },
      date: { gte: startOfLocalDay(date), lt: endOfLocalDayExclusive(date) },
      ...(PAY_UNREPAIRED_VISITS ? {} : { outcome: 'REPAIRED' as const }),
      ...(excludeFormId ? { id: { not: excludeFormId } } : {}),
    },
    select: { standId: true },
  });

  return new Set(forms.map((f) => f.standId)).size;
}

export async function computeWage(params: {
  technicianId: string;
  storeId: string | null;
  standId: string;
  isTehran: boolean;
  outcome: 'REPAIRED' | 'NOT_REPAIRED';
  date: Date;
  excludeFormId?: string;
  settings?: WageSettings;
  db?: Db;
}): Promise<WageResult> {
  const settings = params.settings ?? (await getWageSettings());
  const db = params.db ?? prisma;

  if (params.outcome !== 'REPAIRED' && !PAY_UNREPAIRED_VISITS) {
    return { tier: 1, rate: 0, amount: 0 };
  }

  // With no store on record (an unmatched stray uid) there is no "same store" to
  // discount against, so it is priced as a standalone visit.
  const priorCount = params.storeId
    ? await priorStandsAtStoreToday({
        technicianId: params.technicianId,
        storeId: params.storeId,
        standId: params.standId,
        date: params.date,
        excludeFormId: params.excludeFormId,
        db,
      })
    : 0;

  const tier = priorCount + 1;
  const rate = rateForTier(tier, params.isTehran, settings);
  return { tier, rate, amount: rate };
}
