import 'server-only';

import type { NotRepairedReason } from '@prisma/client';

import { prisma } from './prisma';
import { buildPartsUsageReport } from './exports/parts-usage';
import { projectScopeWhere } from './projects';

/**
 * Dashboard (§7) and analytics (§10).
 *
 * Counting rule that shapes everything here (§6.3): a re-repair is NOT a newly repaired
 * stand — it was already counted the first time — but its parts are real consumption.
 * So `repairedStands` excludes re-repairs while parts totals include them.
 */

export interface RangeFilters {
  from?: Date;
  to?: Date;
  cityId?: string;
  /** Campaign scope — the manager's primary lens once a project is running. */
  projectId?: string | null;
  phaseId?: string | null;
}

function dateWhere(filters: RangeFilters) {
  return {
    ...projectScopeWhere(filters.projectId, filters.phaseId),
    ...(filters.cityId ? { cityId: filters.cityId } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
  };
}

export interface CityStats {
  cityId: string | null;
  cityName: string;
  isTehran: boolean;
  /** Stands repaired, re-repairs excluded (§6.3). */
  repaired: number;
  notRepaired: number;
  reRepairs: number;
  /** Order lines still awaiting a visit. */
  remaining: number;
  totalOrdered: number;
  wageTotal: number;
  /**
   * Distinct UIDs visited. This is the headline the manager tracks: one row of fieldwork
   * per UID, whatever the outcome.
   */
  totalUids: number;
  /**
   * Of those, the ones serviced as the second-or-later stand at the same store on the
   * same visit ("double stands"). They are real work but need no extra travel, which is
   * why they are counted — and paid — apart from the primary UIDs.
   */
  subStands: number;
}

export interface OverviewStats {
  cities: CityStats[];
  totals: {
    repaired: number;
    notRepaired: number;
    reRepairs: number;
    remaining: number;
    totalOrdered: number;
    wageTotal: number;
    totalUids: number;
    subStands: number;
    successRate: number;
  };
  /** §7 — technician pay is split this way, so the dashboard tracks both in parallel. */
  split: {
    tehran: Omit<CityStats, 'cityId' | 'cityName' | 'isTehran'>;
    otherCities: Omit<CityStats, 'cityId' | 'cityName' | 'isTehran'>;
  };
  reasons: Array<{ reason: NotRepairedReason; count: number }>;
  generatedAt: string;
}

const EMPTY_BUCKET = {
  repaired: 0,
  notRepaired: 0,
  reRepairs: 0,
  remaining: 0,
  totalOrdered: 0,
  wageTotal: 0,
  totalUids: 0,
  subStands: 0,
};

export async function getOverview(filters: RangeFilters): Promise<OverviewStats> {
  const where = dateWhere(filters);

  const [cities, forms, orderLines] = await Promise.all([
    prisma.city.findMany({ orderBy: { name: 'asc' } }),
    prisma.repairForm.findMany({
      where,
      select: {
        cityId: true,
        standId: true,
        uid: true,
        standIndex: true,
        outcome: true,
        isReRepair: true,
        notRepairedReason: true,
        wageAmount: true,
        wageTier: true,
      },
    }),
    // Outstanding work is a property of the order book, not of a date range — a line
    // imported in phase 1 is still outstanding today.
    prisma.orderLine.groupBy({
      by: ['cityName', 'status'],
      _count: { _all: true },
      where: {
        status: { not: 'EXCLUDED' },
        // Outstanding work belongs to the campaign that ordered it.
        ...(filters.projectId && filters.projectId !== 'all'
          ? {
              batch: {
                projectId: filters.projectId === '__none__' ? null : filters.projectId,
                ...(filters.phaseId && filters.phaseId !== 'all'
                  ? { phaseId: filters.phaseId }
                  : {}),
              },
            }
          : {}),
      },
    }),
  ]);

  const byCityId = new Map<string | null, CityStats>();
  const cityByName = new Map<string, (typeof cities)[number]>();
  for (const city of cities) {
    cityByName.set(city.name, city);
    byCityId.set(city.id, {
      cityId: city.id,
      cityName: city.name,
      isTehran: city.isTehran,
      ...EMPTY_BUCKET,
    });
  }

  const bucketFor = (cityId: string | null): CityStats => {
    const existing = byCityId.get(cityId);
    if (existing) return existing;
    const fallback: CityStats = {
      cityId: null,
      cityName: 'نامشخص',
      isTehran: false,
      ...EMPTY_BUCKET,
    };
    byCityId.set(cityId, fallback);
    return fallback;
  };

  const reasonCounts = new Map<NotRepairedReason, number>();

  // Stands share their store's uid, so "uids visited" counts distinct LOCATIONS while
  // "sub-stands" counts the individual stands beyond the first at those locations. A
  // three-stand store visited once is 1 uid and 2 sub-stands.
  const uidsSeen = new Map<string | null, Set<string>>();
  const subStandsSeen = new Map<string | null, Set<string>>();
  const track = (map: Map<string | null, Set<string>>, key: string | null, id: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  };

  for (const form of forms) {
    const bucket = bucketFor(form.cityId);
    track(uidsSeen, form.cityId, form.uid);
    if (form.standIndex >= 2) track(subStandsSeen, form.cityId, form.standId);
    if (form.outcome === 'REPAIRED') {
      if (form.isReRepair) bucket.reRepairs++;
      else bucket.repaired++;
    } else {
      bucket.notRepaired++;
      if (form.notRepairedReason) {
        reasonCounts.set(
          form.notRepairedReason,
          (reasonCounts.get(form.notRepairedReason) ?? 0) + 1,
        );
      }
    }
    bucket.wageTotal += Number(form.wageAmount ?? 0);
  }

  for (const [cityId, set] of uidsSeen) bucketFor(cityId).totalUids = set.size;
  for (const [cityId, set] of subStandsSeen) bucketFor(cityId).subStands = set.size;

  for (const group of orderLines) {
    const city = group.cityName ? cityByName.get(group.cityName) : undefined;
    const bucket = bucketFor(city?.id ?? null);
    const count = group._count._all;
    bucket.totalOrdered += count;
    if (group.status === 'PENDING') bucket.remaining += count;
  }

  const list = [...byCityId.values()].filter(
    (c) =>
      c.repaired ||
      c.notRepaired ||
      c.reRepairs ||
      c.totalOrdered ||
      c.remaining ||
      c.totalUids,
  );

  const sum = (pick: (c: CityStats) => number, filter?: (c: CityStats) => boolean) =>
    list.filter(filter ?? (() => true)).reduce((acc, c) => acc + pick(c), 0);

  const bucketOf = (filter: (c: CityStats) => boolean) => ({
    repaired: sum((c) => c.repaired, filter),
    notRepaired: sum((c) => c.notRepaired, filter),
    reRepairs: sum((c) => c.reRepairs, filter),
    remaining: sum((c) => c.remaining, filter),
    totalOrdered: sum((c) => c.totalOrdered, filter),
    wageTotal: sum((c) => c.wageTotal, filter),
    totalUids: sum((c) => c.totalUids, filter),
    subStands: sum((c) => c.subStands, filter),
  });

  const totalRepaired = sum((c) => c.repaired);
  const totalNotRepaired = sum((c) => c.notRepaired);
  const visited = totalRepaired + totalNotRepaired;

  return {
    cities: list.sort((a, b) => b.repaired - a.repaired),
    totals: {
      repaired: totalRepaired,
      notRepaired: totalNotRepaired,
      reRepairs: sum((c) => c.reRepairs),
      remaining: sum((c) => c.remaining),
      totalOrdered: sum((c) => c.totalOrdered),
      wageTotal: sum((c) => c.wageTotal),
      totalUids: sum((c) => c.totalUids),
      subStands: sum((c) => c.subStands),
      successRate: visited > 0 ? Math.round((totalRepaired / visited) * 1000) / 10 : 0,
    },
    split: {
      tehran: bucketOf((c) => c.isTehran),
      otherCities: bucketOf((c) => !c.isTehran),
    },
    reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * §10 — part-need rates and forecasting
 * ------------------------------------------------------------------ */

export interface PartRateRow {
  nameFa: string;
  nameEn: string;
  sortOrder: number;
  /** Distinct repaired stands that needed this part. */
  standCount: number;
  /** e.g. 53 — "53% of stands needed a transformer replaced". */
  percentOfStands: number;
  totalQuantity: number;
  /** Average units consumed per repaired stand — the forecasting basis. */
  perStandRate: number;
}

export interface PartRatesResult {
  rows: PartRateRow[];
  repairedStandCount: number;
}

export async function getPartRates(filters: RangeFilters): Promise<PartRatesResult> {
  const report = await buildPartsUsageReport(filters);
  const denominator = report.repairedStandCount;

  const rows = report.rows
    .map((row) => ({
      nameFa: row.nameFa,
      nameEn: row.nameEn,
      sortOrder: row.sortOrder,
      standCount: row.standCount,
      percentOfStands:
        denominator > 0 ? Math.round((row.standCount / denominator) * 1000) / 10 : 0,
      totalQuantity: row.total,
      perStandRate: denominator > 0 ? row.total / denominator : 0,
    }))
    .sort((a, b) => b.percentOfStands - a.percentOfStands);

  return { rows, repairedStandCount: denominator };
}

export interface ForecastRow {
  nameFa: string;
  nameEn: string;
  perStandRate: number;
  estimatedQuantity: number;
}

/**
 * §10 — given historical consumption and the stand count of an upcoming phase, estimate
 * the parts to stock. Deliberately a simple linear projection from the observed
 * per-stand rate; anything fancier would be false precision on this data volume.
 */
export async function forecastParts(
  upcomingStandCount: number,
  filters: RangeFilters,
): Promise<{ rows: ForecastRow[]; basisStandCount: number }> {
  const { rows, repairedStandCount } = await getPartRates(filters);

  return {
    basisStandCount: repairedStandCount,
    rows: rows
      .map((row) => ({
        nameFa: row.nameFa,
        nameEn: row.nameEn,
        perStandRate: Math.round(row.perStandRate * 1000) / 1000,
        estimatedQuantity: Math.ceil(row.perStandRate * upcomingStandCount),
      }))
      .filter((r) => r.estimatedQuantity > 0),
  };
}

/* ------------------------------------------------------------------ *
 * §4.6 — a technician's own stats
 * ------------------------------------------------------------------ */

export async function getTechnicianStats(technicianId: string, filters: RangeFilters) {
  const where = { ...dateWhere(filters), technicianId };

  const [forms, byReason] = await Promise.all([
    prisma.repairForm.findMany({
      where,
      select: {
        outcome: true,
        isReRepair: true,
        wageAmount: true,
        cityId: true,
        city: { select: { name: true, isTehran: true } },
      },
    }),
    prisma.repairForm.groupBy({
      by: ['notRepairedReason'],
      where: { ...where, outcome: 'NOT_REPAIRED' },
      _count: { _all: true },
    }),
  ]);

  const perCity = new Map<string, { repaired: number; notRepaired: number; wage: number }>();
  let repaired = 0;
  let notRepaired = 0;
  let reRepairs = 0;
  let wageTotal = 0;

  for (const form of forms) {
    const key = form.city?.name ?? 'نامشخص';
    const bucket = perCity.get(key) ?? { repaired: 0, notRepaired: 0, wage: 0 };
    if (form.outcome === 'REPAIRED') {
      if (form.isReRepair) reRepairs++;
      else repaired++;
      bucket.repaired++;
    } else {
      notRepaired++;
      bucket.notRepaired++;
    }
    const wage = Number(form.wageAmount ?? 0);
    wageTotal += wage;
    bucket.wage += wage;
    perCity.set(key, bucket);
  }

  return {
    repaired,
    notRepaired,
    reRepairs,
    totalVisits: forms.length,
    wageTotal,
    perCity: [...perCity.entries()].map(([cityName, v]) => ({ cityName, ...v })),
    reasons: byReason
      .filter((r) => r.notRepairedReason)
      .map((r) => ({ reason: r.notRepairedReason as NotRepairedReason, count: r._count._all })),
  };
}
