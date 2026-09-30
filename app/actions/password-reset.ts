'use server';

import { revalidatePath } from 'next/cache';

import { hashPassword, normalisePhone, requireActionManager } from '@/lib/auth';
import { LicenseReadOnlyError } from '@/lib/license';
import { prisma } from '@/lib/prisma';

import type { ActionState } from './manager';

/** Same floor as technician sign-up. */
const MIN_PASSWORD = 6;

/**
 * "I forgot my password", from the login page — no session.
 *
 * Always answers the same way, whether or not the number belongs to anyone, so the form
 * cannot be used to find out who has an account. Only an approved technician or lead
 * actually gets a request filed, and at most one open request each: pressing the button
 * ten times still puts one line in front of the manager.
 */
export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const phone = normalisePhone(String(formData.get('phone') ?? ''));
  if (!/^0\d{10}$/.test(phone)) return { error: 'invalidPhone' };

  try {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (
      user &&
      user.status === 'APPROVED' &&
      (user.role === 'TECHNICIAN' || user.role === 'LEAD_TECHNICIAN')
    ) {
      const open = await prisma.passwordResetRequest.findFirst({
        where: { userId: user.id, status: 'PENDING' },
      });
      if (!open) await prisma.passwordResetRequest.create({ data: { userId: user.id } });
    }
  } catch (err) {
    // An expired license makes the app read-only; say so rather than crash the page.
    if (err instanceof LicenseReadOnlyError) return { error: 'readOnly' };
    throw err;
  }

  return { ok: 'sent' };
}

/** The manager answers a request: set a temporary password, or dismiss it. */
export async function resolvePasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');
  const requestId = String(formData.get('requestId') ?? '');
  const decision = String(formData.get('decision') ?? '');

  const request = await prisma.passwordResetRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== 'PENDING') return { error: 'generic' };

  if (decision === 'DISMISS') {
    await prisma.passwordResetRequest.update({
      where: { id: requestId },
      data: { status: 'DISMISSED', resolvedAt: new Date() },
    });
  } else {
    const password = String(formData.get('password') ?? '');
    if (password.length < MIN_PASSWORD) return { error: 'passwordTooShort' };

    // A new password also ends every session opened with the old one (credentialStamp).
    await prisma.$transaction([
      prisma.user.update({
        where: { id: request.userId },
        data: { passwordHash: await hashPassword(password) },
      }),
      // Anything else still open for this person is answered by the same new password.
      prisma.passwordResetRequest.updateMany({
        where: { userId: request.userId, status: 'PENDING' },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      }),
    ]);
  }

  revalidatePath(`/${locale}/manager`, 'layout');
  return { ok: decision === 'DISMISS' ? 'dismissed' : 'passwordSet' };
}
