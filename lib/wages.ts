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
 * UNSUCCESSFUL VISITS (client ruling): the technician travelled either way, so every
 * visit that produced no repair earns the flat `unrepairedVisitRate` the manager sets —
 * whatever the reason. A temporarily-closed store is still expected to be revisited, and
 * when that later visit does produce a repair it is priced normally by the tier rules
 * below; the call-out rate for the wasted trip is not deducted from it.
 */
export const PAY_UNREPAIRED_VISITS = true;

export interface WageResult {
  /**
   * 1 = first stand at this store today, 2 = second, 3+ = third or later.
   * 0 marks a flat call-out payment, which sits outside the tier ladder entirely.
   */
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
      // Only actual repairs occupy a tier slot. An unsuccessful visit is paid the flat
      // call-out rate and must not demote a stand repaired later at the same store.
      outcome: 'REPAIRED',
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

  // A wasted trip is paid at a flat rate and never consumes a tier slot: it must not
  // push a stand the technician *does* repair at the same store down to the reduced
  // second-stand rate, so it is priced and returned before the tier lookup.
  if (params.outcome !== 'REPAIRED') {
    const rate = PAY_UNREPAIRED_VISITS ? settings.unrepairedVisitRate : 0;
    return { tier: 0, rate, amount: rate };
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
