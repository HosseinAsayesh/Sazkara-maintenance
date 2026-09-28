'use server';

import { revalidatePath } from 'next/cache';

import { requireActionUser } from '@/lib/auth';
import { getClientScope } from '@/lib/client-view';
import { prisma } from '@/lib/prisma';
import { projectScopeWhere } from '@/lib/projects';

export interface QueryActionState {
  error?: string;
  ok?: string;
}

const MIN_BODY = 3;
const MAX_BODY = 2000;

function revalidate(locale: string, formId?: string) {
  revalidatePath(`/${locale}/client/queries`);
  revalidatePath(`/${locale}/manager/queries`);
  if (formId) revalidatePath(`/${locale}/client/form/${formId}`);
}

/**
 * Jti raises a question against one repair form.
 *
 * Only the client opens threads. A manager wanting to say something about a stand has
 * the whole system to say it in; letting them open a thread here would turn the client's
 * question list into an inbox, and the one thing this list has to stay is short.
 */
export async function raiseQueryAction(
  _prev: QueryActionState,
  formData: FormData,
): Promise<QueryActionState> {
  const user = await requireActionUser();
  if (user.role !== 'CLIENT_SUPERVISOR') throw new Error('FORBIDDEN');

  const formId = String(formData.get('formId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const locale = String(formData.get('locale') || 'fa');

  if (!formId) return { error: 'generic' };
  if (body.length < MIN_BODY) return { error: 'bodyRequired' };
  if (body.length > MAX_BODY) return { error: 'bodyTooLong' };

  const scope = await getClientScope();
  if (!scope) return { error: 'noActiveProject' };

  // Scoped to the campaign, so a form id from an earlier project cannot be queried by
  // pasting it into the URL.
  const form = await prisma.repairForm.findFirst({
    where: { id: formId, ...projectScopeWhere(scope.projectId) },
    select: { id: true },
  });
  if (!form) return { error: 'notFound' };

  await prisma.formQuery.create({
    data: {
      repairFormId: form.id,
      openedById: user.id,
      status: 'OPEN',
      messages: { create: { authorId: user.id, body } },
    },
  });

  revalidate(locale, formId);
  return { ok: 'raised' };
}

/**
 * A reply from either side.
 *
 * The status moves with the reply rather than by anyone setting it: the team answering
 * makes it ANSWERED, Jti coming back makes it OPEN again. Nobody has to remember to
 * mark anything, which is the only way a status stays true.
 */
export async function replyQueryAction(
  _prev: QueryActionState,
  formData: FormData,
): Promise<QueryActionState> {
  const user = await requireActionUser();
  if (user.role !== 'CLIENT_SUPERVISOR' && user.role !== 'MANAGER') {
    throw new Error('FORBIDDEN');
  }

  const queryId = String(formData.get('queryId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const locale = String(formData.get('locale') || 'fa');

  if (!queryId) return { error: 'generic' };
  if (body.length < MIN_BODY) return { error: 'bodyRequired' };
  if (body.length > MAX_BODY) return { error: 'bodyTooLong' };

  const thread = await prisma.formQuery.findUnique({
    where: { id: queryId },
    select: { id: true, status: true, repairFormId: true },
  });
  if (!thread) return { error: 'notFound' };
  if (thread.status === 'RESOLVED') return { error: 'alreadyResolved' };

  await prisma.$transaction([
    prisma.formQueryMessage.create({
      data: { queryId: thread.id, authorId: user.id, body },
    }),
    prisma.formQuery.update({
      where: { id: thread.id },
      data: { status: user.role === 'MANAGER' ? 'ANSWERED' : 'OPEN' },
    }),
  ]);

  revalidate(locale, thread.repairFormId);
  return { ok: 'replied' };
}

/**
 * Closing a thread.
 *
 * Either side may close: Jti because their question was answered, the manager because
 * it was dealt with off-system. What a manager may NOT do is close a thread nobody has
 * answered — that is how a question gets made to disappear rather than addressed, and
 * this list only means anything if closing it costs a reply.
 */
export async function resolveQueryAction(
  _prev: QueryActionState,
  formData: FormData,
): Promise<QueryActionState> {
  const user = await requireActionUser();
  if (user.role !== 'CLIENT_SUPERVISOR' && user.role !== 'MANAGER') {
    throw new Error('FORBIDDEN');
  }

  const queryId = String(formData.get('queryId') ?? '');
  const locale = String(formData.get('locale') || 'fa');
  if (!queryId) return { error: 'generic' };

  const thread = await prisma.formQuery.findUnique({
    where: { id: queryId },
    select: { id: true, status: true, repairFormId: true },
  });
  if (!thread) return { error: 'notFound' };
  if (thread.status === 'RESOLVED') return { error: 'alreadyResolved' };

  if (user.role === 'MANAGER' && thread.status === 'OPEN') {
    return { error: 'answerBeforeResolving' };
  }

  await prisma.formQuery.update({
    where: { id: thread.id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });

  revalidate(locale, thread.repairFormId);
  return { ok: 'resolved' };
}
