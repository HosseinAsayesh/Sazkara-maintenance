import 'server-only';

import { type RangeFilters } from './analytics';
import { projectScopeWhere } from './projects';
import { prisma } from './prisma';

/**
 * The lists behind the dashboard's headline numbers.
 *
 * The dashboard answers "how many"; this answers "which ones". The question that forced
 * it is the one the repair manager actually has at the end of a campaign: a hundred uids
 * went out, ninety-five came back, and nobody can name the five. A count cannot be
 * chased — a list can.
 *
 * Every query here is built from the SAME predicates `getOverview` uses, so a card and
 * its list can never disagree. In particular outstanding work is filtered by campaign but
 * NOT by date: a line ordered in phase one is still outstanding today, and dating it out
 * of the list would hide exactly the stale work this is for.
 */

export type BreakdownMetric =
  | 'remaining'
  | 'totalOrdered'
  | 'totalUids'
  | 'subStands'
  | 'repaired'
  | 'notRepaired'
  | 'reRepairs';

export const BREAKDOWN_METRICS: BreakdownMetric[] = [
  'remaining',
  'totalOrdered',
  'totalUids',
  'subStands',
  'repaired',
  'notRepaired',
  'reRepairs',
];

export function isBreakdownMetric(value: string): value is BreakdownMetric {
  return (BREAKDOWN_METRICS as string[]).includes(value);
}

export interface OrderLineRow {
  id: string;
  uid: string;
  storeName: string | null;
  cityName: string | null;
  address: string | null;
  status: string;
  batchLabel: string;
  projectName: string | null;
  phaseName: string | null;
  isDuplicate: boolean;
}

export interface FormRow {
  id: string;
  uid: string;
  standIndex: number;
  cityName: string | null;
  storeName: string | null;
  date: Date;
  formCode: string | null;
  technicianName: string | null;
  outcome: string;
  notRepairedReason: string | null;
  isReRepair: boolean;
}

/** Order lines carry a snapshot city NAME, not a city id, so they filter by name. */
export interface BreakdownFilters extends RangeFilters {
  cityName?: string;
}

export type BreakdownResult =
  | { kind: 'orderLines'; metric: BreakdownMetric; rows: OrderLineRow[]; total: number }
  | { kind: 'forms'; metric: BreakdownMetric; rows: FormRow[]; total: number };

/** Metrics answered from the order book rather than from submitted work. */
const ORDER_LINE_METRICS = new Set<BreakdownMetric>(['remaining', 'totalOrdered']);

const MAX_ROWS = 2000;

function orderLineWhere(metric: BreakdownMetric, filters: BreakdownFilters) {
  const scoped =
    filters.projectId && filters.projectId !== 'all'
      ? {
          batch: {
            projectId: filters.projectId === '__none__' ? null : filters.projectId,
            ...(filters.phaseId && filters.phaseId !== 'all'
              ? { phaseId: filters.phaseId }
              : {}),
          },
        }
      : {};

  return {
    // EXCLUDED lines were deliberately kept out of the campaign at import; counting them
    // as outstanding would send a technician back to a shop the manager already dropped.
    status: metric === 'remaining' ? ('PENDING' as const) : { not: 'EXCLUDED' as const },
    ...scoped,
    ...(filters.cityName ? { cityName: filters.cityName } : {}),
  };
}

function formWhere(metric: BreakdownMetric, filters: RangeFilters) {
  const base = {
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

  switch (metric) {
    // The headline "repaired" excludes within-project re-repairs (§6.3), so this list
    // must too, or the list will out-count the card it was opened from.
    case 'repaired':
      return { ...base, outcome: 'REPAIRED' as const, isReRepair: false };
    case 'reRepairs':
      return { ...base, outcome: 'REPAIRED' as const, isReRepair: true };
    case 'notRepaired':
      return { ...base, outcome: 'NOT_REPAIRED' as const };
    // A store's second and third stands. The first stand of every store is excluded, so
    // this lists the extra cabinets rather than the visits.
    case 'subStands':
      return { ...base, standIndex: { gte: 2 } };
    default:
      return base;
  }
}

export async function getBreakdown(
  metric: BreakdownMetric,
  filters: BreakdownFilters,
): Promise<BreakdownResult> {
  if (ORDER_LINE_METRICS.has(metric)) {
    const where = orderLineWhere(metric, filters);
    const [rows, total] = await Promise.all([
      prisma.orderLine.findMany({
        where,
        orderBy: [{ cityName: 'asc' }, { uid: 'asc' }],
        take: MAX_ROWS,
        include: {
          batch: {
            select: {
              name: true,
              importedAt: true,
              project: { select: { name: true } },
              phase: { select: { name: true } },
            },
          },
        },
      }),
      prisma.orderLine.count({ where }),
    ]);

    return {
      kind: 'orderLines',
      metric,
      total,
      rows: rows.map((line) => ({
        id: line.id,
        uid: line.uid,
        storeName: line.storeName,
        cityName: line.cityName,
        address: line.address,
        status: line.status,
        batchLabel: line.batch?.name ?? '—',
        projectName: line.batch?.project?.name ?? null,
        phaseName: line.batch?.phase?.name ?? null,
        isDuplicate: line.isDuplicate,
      })),
    };
  }

  const where = formWhere(metric, filters);

  // "Uids visited" counts distinct LOCATIONS, so listing every form would repeat a
  // three-stand store three times. One row per uid, showing its first stand.
  const distinctByUid = metric === 'totalUids';

  const forms = await prisma.repairForm.findMany({
    where,
    orderBy: [{ date: 'desc' }, { uid: 'asc' }],
    take: distinctByUid ? undefined : MAX_ROWS,
    include: {
      city: { select: { name: true } },
      technician: { select: { name: true } },
      store: { select: { name: true } },
    },
  });

  const seen = new Set<string>();
  const rows: FormRow[] = [];
  for (const form of forms) {
    if (distinctByUid) {
      if (seen.has(form.uid)) continue;
      seen.add(form.uid);
    }
    if (rows.length >= MAX_ROWS) break;
    rows.push({
      id: form.id,
      uid: form.uid,
      standIndex: form.standIndex,
      cityName: form.city?.name ?? null,
      storeName: form.store?.name ?? null,
      date: form.date,
      formCode: form.formCode,
      technicianName: form.technician?.name ?? null,
      outcome: form.outcome,
      notRepairedReason: form.notRepairedReason,
      isReRepair: form.isReRepair,
    });
  }

  return {
    kind: 'forms',
    metric,
    total: distinctByUid ? seen.size : forms.length,
    rows,
  };
}
