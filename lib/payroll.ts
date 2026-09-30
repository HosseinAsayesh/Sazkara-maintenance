import 'server-only';

import type { Prisma } from '@prisma/client';

import { HISTORICAL_TECHNICIAN_PHONE } from './historical';
import { prisma } from './prisma';
import { projectScopeWhere } from './projects';

/**
 * What each technician is owed for a period.
 *
 * Adds up the wage FROZEN on each report at submit time (`RepairForm.wageAmount`, see
 * lib/wages.ts) — never recomputed with today's rates, so editing a rate in Settings
 * cannot silently rewrite what someone was owed last month.
 *
 * The only policy lever is re-repairs: a stand repaired again within the same project
 * means the first repair did not hold, and whether that second visit is paid is the
 * manager's call. Their amounts are always shown; the toggle decides whether they count
 * toward the total.
 */

export interface PayrollFilters {
  from?: Date;
  to?: Date;
  cityId?: string;
  projectId?: string;
  phaseId?: string;
  technicianId?: string;
  includeReRepairs: boolean;
}

export interface PayrollRow {
  technicianId: string;
  name: string;
  code: string;
  /** Repaired stands by wage tier: first at the store that day, second, third or later. */
  firstStands: number;
  secondStands: number;
  thirdPlusStands: number;
  /** Visits that produced no repair — paid the flat call-out rate. */
  unrepairedVisits: number;
  reRepairs: number;
  reRepairAmount: number;
  /** What is payable under the current re-repair choice. */
  total: number;
}

export interface PayrollLine {
  date: Date;
  technicianName: string;
  technicianCode: string;
  formCode: string;
  uid: string;
  standIndex: number;
  cityName: string;
  outcome: string;
  tier: number;
  isReRepair: boolean;
  amount: number;
  counted: boolean;
}

export function payrollWhere(filters: PayrollFilters): Prisma.RepairFormWhereInput {
  return {
    ...projectScopeWhere(filters.projectId, filters.phaseId),
    ...(filters.cityId ? { cityId: filters.cityId } : {}),
    ...(filters.technicianId ? { technicianId: filters.technicianId } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
    // Imported archive rows belong to a placeholder account, not to anyone on payroll.
    technician: { phone: { not: HISTORICAL_TECHNICIAN_PHONE } },
  };
}

async function loadForms(filters: PayrollFilters) {
  return prisma.repairForm.findMany({
    where: payrollWhere(filters),
    orderBy: [{ date: 'asc' }, { formCode: 'asc' }],
    select: {
      date: true,
      formCode: true,
      uid: true,
      standIndex: true,
      outcome: true,
      wageTier: true,
      wageAmount: true,
      isReRepair: true,
      technicianId: true,
      technician: { select: { name: true, technicianCode: true } },
      city: { select: { name: true } },
    },
  });
}

export async function getPayroll(filters: PayrollFilters) {
  const forms = await loadForms(filters);
  const byTech = new Map<string, PayrollRow>();

  for (const form of forms) {
    let row = byTech.get(form.technicianId);
    if (!row) {
      row = {
        technicianId: form.technicianId,
        name: form.technician.name,
        code: form.technician.technicianCode ?? '',
        firstStands: 0,
        secondStands: 0,
        thirdPlusStands: 0,
        unrepairedVisits: 0,
        reRepairs: 0,
        reRepairAmount: 0,
        total: 0,
      };
      byTech.set(form.technicianId, row);
    }

    const amount = Number(form.wageAmount ?? 0);

    if (form.isReRepair) {
      row.reRepairs++;
      row.reRepairAmount += amount;
      if (filters.includeReRepairs) row.total += amount;
      continue;
    }

    if (form.outcome !== 'REPAIRED') row.unrepairedVisits++;
    else if (form.wageTier <= 1) row.firstStands++;
    else if (form.wageTier === 2) row.secondStands++;
    else row.thirdPlusStands++;
    row.total += amount;
  }

  const rows = [...byTech.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (acc, r) => ({
      firstStands: acc.firstStands + r.firstStands,
      secondStands: acc.secondStands + r.secondStands,
      thirdPlusStands: acc.thirdPlusStands + r.thirdPlusStands,
      unrepairedVisits: acc.unrepairedVisits + r.unrepairedVisits,
      reRepairs: acc.reRepairs + r.reRepairs,
      reRepairAmount: acc.reRepairAmount + r.reRepairAmount,
      total: acc.total + r.total,
    }),
    {
      firstStands: 0,
      secondStands: 0,
      thirdPlusStands: 0,
      unrepairedVisits: 0,
      reRepairs: 0,
      reRepairAmount: 0,
      total: 0,
    },
  );

  return { rows, totals };
}

/** One line per report, for the audit sheet of the Excel export. */
export async function getPayrollLines(filters: PayrollFilters): Promise<PayrollLine[]> {
  const forms = await loadForms(filters);
  return forms.map((form) => ({
    date: form.date,
    technicianName: form.technician.name,
    technicianCode: form.technician.technicianCode ?? '',
    formCode: form.formCode,
    uid: form.uid,
    standIndex: form.standIndex,
    cityName: form.city?.name ?? '',
    outcome: form.outcome,
    tier: form.wageTier,
    isReRepair: form.isReRepair,
    amount: Number(form.wageAmount ?? 0),
    counted: !form.isReRepair || filters.includeReRepairs,
  }));
}

/** Reads the payroll filters from a page's or route's query string. */
export function readPayrollParams(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  return {
    from: one('from'),
    to: one('to'),
    cityId: one('cityId'),
    projectId: one('projectId'),
    phaseId: one('phaseId'),
    technicianId: one('technicianId'),
    // Paid unless the manager chooses otherwise: the wage was already earned and frozen
    // on the report when it was submitted.
    includeReRepairs: one('reRepairs') !== 'exclude',
  };
}
