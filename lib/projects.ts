import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from './prisma';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Projects and phases.
 *
 * A project is one Jti campaign. It matters for three separate reasons:
 *
 *  1. Focus — once a new campaign starts the manager works almost entirely inside it, so
 *     it is the default filter on the dashboard, exports and analytics.
 *  2. Re-repair scope (§6.3, revised) — a uid serviced in two different projects is
 *     normal recurring work; serviced twice inside ONE project it is a re-repair.
 *  3. Export shape — the main Jti workbook carries every stand repaired during the
 *     project (including ones seen in earlier projects); within-project re-repairs go to
 *     a separate workbook.
 */

export const NO_PROJECT = '__none__';

export async function listProjects() {
  return prisma.project.findMany({
    orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    include: {
      phases: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { repairForms: true, batches: true } },
    },
  });
}

export async function getActiveProject() {
  return prisma.project.findFirst({
    where: { isActive: true },
    include: { phases: { orderBy: { sortOrder: 'asc' } } },
  });
}

/** Lightweight list for filter dropdowns. */
export async function listProjectOptions() {
  return prisma.project.findMany({
    orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    select: {
      id: true,
      name: true,
      isActive: true,
      phases: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, sortOrder: true },
      },
    },
  });
}

/**
 * Only one project can be active at a time — the dashboard defaults to it, so two
 * actives would make the default ambiguous.
 */
export async function setActiveProject(projectId: string) {
  await prisma.$transaction([
    prisma.project.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.project.update({ where: { id: projectId }, data: { isActive: true } }),
  ]);
}

export async function createProject(input: {
  name: string;
  code?: string | null;
  startDate: Date;
  endDate?: Date | null;
  notes?: string | null;
  makeActive?: boolean;
  phaseNames?: string[];
}) {
  const project = await prisma.project.create({
    data: {
      name: input.name.trim(),
      code: input.code?.trim() || null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      notes: input.notes?.trim() || null,
      phases: {
        create: (input.phaseNames?.length ? input.phaseNames : ['فاز ۱']).map(
          (name, i) => ({ name: name.trim() || `فاز ${i + 1}`, sortOrder: i + 1 }),
        ),
      },
    },
    include: { phases: true },
  });

  if (input.makeActive) await setActiveProject(project.id);
  return project;
}

export async function addPhase(projectId: string, name: string) {
  const last = await prisma.phase.findFirst({
    where: { projectId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return prisma.phase.create({
    data: { projectId, name: name.trim(), sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
}

/**
 * Which project a visit to `uid` belongs to.
 *
 * Preference order: the batch of the most recent open order row carrying this uid, then
 * the active project. A stray uid the technician found in the field therefore lands in
 * the campaign that is currently running, which is what makes it show up in that
 * project's export.
 */
export async function resolveProjectForUid(
  db: Db,
  uid: string,
): Promise<{ projectId: string | null; phaseId: string | null }> {
  const line = await db.orderLine.findFirst({
    where: { uid, status: { not: 'EXCLUDED' } },
    orderBy: { createdAt: 'desc' },
    select: { batch: { select: { projectId: true, phaseId: true } } },
  });

  if (line?.batch?.projectId) {
    return { projectId: line.batch.projectId, phaseId: line.batch.phaseId };
  }

  const active = await db.project.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  return { projectId: active?.id ?? null, phaseId: null };
}

/**
 * Prisma `where` fragment for a project/phase filter, shared by the dashboard, exports,
 * analytics and evidence so they can never drift apart.
 */
export function projectScopeWhere(projectId?: string | null, phaseId?: string | null) {
  if (!projectId || projectId === 'all') return {};
  if (projectId === NO_PROJECT) return { projectId: null };
  return { projectId, ...(phaseId && phaseId !== 'all' ? { phaseId } : {}) };
}
