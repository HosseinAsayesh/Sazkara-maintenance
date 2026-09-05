'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ProjectDeleteError,
  addPhase,
  createProject,
  deleteProject,
  setActiveProject,
} from '@/lib/projects';

export interface ActionState {
  error?: string;
  ok?: string;
}

function revalidateManager(locale: string) {
  revalidatePath(`/${locale}/manager`, 'layout');
}

/* ------------------------------------------------------------------ *
 * Projects and phases
 * ------------------------------------------------------------------ */

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const name = String(formData.get('name') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const startDate = String(formData.get('startDate') ?? '').trim();
  const endDate = String(formData.get('endDate') ?? '').trim();
  const phaseNames = String(formData.get('phaseNames') ?? '')
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!name) return { error: 'nameRequired' };
  if (!startDate) return { error: 'startDateRequired' };

  const duplicate = await prisma.project.findUnique({ where: { name } });
  if (duplicate) return { error: 'exists' };

  await createProject({
    name,
    code: code || null,
    // The pickers hand over an ISO day; midday avoids any timezone edge landing on the
    // previous date when Postgres casts it to a bare DATE.
    startDate: new Date(`${startDate}T12:00:00Z`),
    endDate: endDate ? new Date(`${endDate}T12:00:00Z`) : null,
    phaseNames,
    makeActive: formData.get('makeActive') === 'on',
  });

  revalidateManager(locale);
  return { ok: 'created' };
}

export async function setActiveProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return { error: 'generic' };

  await setActiveProject(projectId);
  revalidateManager(locale);
  return { ok: 'success' };
}

export async function addPhaseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const projectId = String(formData.get('projectId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!projectId || !name) return { error: 'nameRequired' };

  const existing = await prisma.phase.findUnique({
    where: { projectId_name: { projectId, name } },
  });
  if (existing) return { error: 'exists' };

  await addPhase(projectId, name);
  revalidateManager(locale);
  return { ok: 'success' };
}

/**
 * Delete a project. Empty ones go on a plain confirmation; a project with fieldwork
 * attached needs `force`, and even then the forms are detached, never destroyed.
 */
export async function deleteProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();

  const locale = String(formData.get('locale') || 'fa');
  const projectId = String(formData.get('projectId') ?? '');
  const force = String(formData.get('force') ?? '') === 'true';
  if (!projectId) return { error: 'generic' };

  try {
    await deleteProject(projectId, { force });
  } catch (err) {
    if (err instanceof ProjectDeleteError) {
      return { error: err.code === 'NOT_FOUND' ? 'notFound' : 'projectNotEmpty' };
    }
    console.error('deleteProjectAction failed', err);
    return { error: 'generic' };
  }

  revalidateManager(locale);
  return { ok: 'projectDeleted' };
}
