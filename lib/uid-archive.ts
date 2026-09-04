import 'server-only';

import { prisma } from './prisma';
import { projectScopeWhere } from './projects';

/**
 * The UID archive — one row per uid rather than one row per form.
 *
 * The dashboard's "recent reports" answers "what just happened"; this answers "what is on
 * file for this period". A uid can carry several forms (multiple stands at the store, a
 * re-repair, a failed visit followed by a successful one), and the manager needs them
 * collapsed into a single line they can scan, filter and drill into.
 *
 * It lives on its own page deliberately: folding it into the dashboard would bury the
 * live counters it sits next to.
 */

export interface UidArchiveFilters {
  from?: Date;
  to?: Date;
  cityId?: string;
  projectId?: string | null;
  phaseId?: string | null;
  /** Free-text match on uid or store name. */
  query?: string;
}

export interface UidArchiveRow {
  uid: string;
  storeName: string | null;
  cityName: string | null;
  projectName: string | null;
  /** Distinct stands serviced at this uid within the filter. */
  standCount: number;
  formCount: number;
  repaired: number;
  notRepaired: number;
  reRepairs: number;
  /** Replaced-part quantity across every form on this uid. */
  partsReplaced: number;
  firstVisit: Date;
  lastVisit: Date;
  technicianCodes: string[];
}

export interface UidArchiveResult {
  rows: UidArchiveRow[];
  totalUids: number;
  totalForms: number;
}

export async function listUidArchive(
  filters: UidArchiveFilters,
  limit = 500,
): Promise<UidArchiveResult> {
  const forms = await prisma.repairForm.findMany({
    where: {
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
      ...(filters.query
        ? {
            OR: [
              { uid: { contains: filters.query, mode: 'insensitive' as const } },
              { storeName: { contains: filters.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { date: 'desc' },
    select: {
      uid: true,
      standIndex: true,
      storeName: true,
      outcome: true,
      isReRepair: true,
      date: true,
      city: { select: { name: true } },
      project: { select: { name: true } },
      technician: { select: { technicianCode: true } },
      parts: { select: { action: true, quantity: true } },
    },
  });

  const byUid = new Map<string, UidArchiveRow & { stands: Set<number>; techs: Set<string> }>();

  for (const form of forms) {
    let row = byUid.get(form.uid);
    if (!row) {
      row = {
        uid: form.uid,
        storeName: form.storeName,
        cityName: form.city?.name ?? null,
        projectName: form.project?.name ?? null,
        standCount: 0,
        formCount: 0,
        repaired: 0,
        notRepaired: 0,
        reRepairs: 0,
        partsReplaced: 0,
        firstVisit: form.date,
        lastVisit: form.date,
        technicianCodes: [],
        stands: new Set<number>(),
        techs: new Set<string>(),
      };
      byUid.set(form.uid, row);
    }

    row.formCount++;
    row.stands.add(form.standIndex);
    if (form.technician.technicianCode) row.techs.add(form.technician.technicianCode);

    if (form.outcome === 'REPAIRED') {
      // A re-repair is not a newly repaired stand (§6.3) — counted in its own column.
      if (form.isReRepair) row.reRepairs++;
      else row.repaired++;
    } else {
      row.notRepaired++;
    }

    // §6.8 — only replaced parts are consumed inventory.
    for (const usage of form.parts) {
      if (usage.action === 'REPLACED') row.partsReplaced += usage.quantity;
    }

    if (form.date < row.firstVisit) row.firstVisit = form.date;
    if (form.date > row.lastVisit) row.lastVisit = form.date;
    // The newest form wins for display fields, and forms arrive newest-first.
    row.storeName ??= form.storeName;
    row.cityName ??= form.city?.name ?? null;
    row.projectName ??= form.project?.name ?? null;
  }

  const rows = [...byUid.values()]
    .map(({ stands, techs, ...row }) => ({
      ...row,
      standCount: stands.size,
      technicianCodes: [...techs].sort(),
    }))
    .sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime());

  return {
    rows: rows.slice(0, limit),
    totalUids: rows.length,
    totalForms: forms.length,
  };
}
