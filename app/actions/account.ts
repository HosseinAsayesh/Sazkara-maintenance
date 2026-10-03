'use server';

import {
  credentialStamp,
  hashPassword,
  requireActionManager,
  setSessionCookie,
  verifyPassword,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import type { ActionState } from './manager';

const MIN_PASSWORD = 8;

/**
 * The manager changes their own password. The new password ends every other session
 * opened with the old one (credentialStamp); this browser is re-issued a cookie for the
 * new one, so the person who just changed it stays signed in.
 */
export async function changeOwnPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireActionManager();

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const repeat = String(formData.get('repeatPassword') ?? '');

  if (!(await verifyPassword(current, user.passwordHash))) return { error: 'wrongCurrent' };
  if (next.length < MIN_PASSWORD) return { error: 'tooShort' };
  if (next !== repeat) return { error: 'mismatch' };
  if (next === current) return { error: 'sameAsOld' };

  const passwordHash = await hashPassword(next);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  await setSessionCookie({
    userId: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    technicianCode: user.technicianCode,
    stamp: credentialStamp(passwordHash),
  });

  return { ok: 'changed' };
}
