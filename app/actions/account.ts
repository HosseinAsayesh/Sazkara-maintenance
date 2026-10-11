'use server';

import {
  credentialStamp,
  hashPassword,
  requireActionManager,
  setSessionCookie,
  verifyPassword,
} from '@/lib/auth';
import { revalidatePath } from 'next/cache';

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

/**
 * The manager renames themselves. The name rides in the session cookie (the header shows
 * it), so this browser gets a fresh cookie carrying it; the credential stamp is unchanged,
 * so no other session is signed out by a rename.
 */
export async function changeOwnNameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireActionManager();

  const name = String(formData.get('name') ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { error: 'nameTooShort' };
  if (name.length > 80) return { error: 'nameTooLong' };
  if (name === user.name) return { ok: 'nameChanged' };

  await prisma.user.update({ where: { id: user.id }, data: { name } });

  await setSessionCookie({
    userId: user.id,
    name,
    phone: user.phone,
    role: user.role,
    technicianCode: user.technicianCode,
    stamp: credentialStamp(user.passwordHash),
  });

  revalidatePath('/', 'layout');
  return { ok: 'nameChanged' };
}
