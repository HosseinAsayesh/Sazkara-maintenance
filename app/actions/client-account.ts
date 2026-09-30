'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { hashPassword, normalisePhone, requireActionManager } from '@/lib/auth';
import { findClientAccount } from '@/lib/client-account';
import { prisma } from '@/lib/prisma';

import type { ActionState } from './manager';

/**
 * Longer than a technician's six: this is the one login held outside the company, it
 * sees the client's whole campaign, and the whole JTI team shares it.
 */
const MIN_PASSWORD = 8;

const schema = z.object({
  name: z.string().trim().min(2, 'nameRequired'),
  phone: z
    .string()
    .transform(normalisePhone)
    .refine((v) => /^0\d{10}$/.test(v), { message: 'invalidPhone' }),
  password: z.string(),
  passwordConfirm: z.string(),
});

/**
 * Creates the shared JTI supervisor login, or updates it: name, phone and — when a new
 * password is typed — the password. A new password ends every session opened with the
 * old one (see `credentialStamp`), so a reset locks out whoever had it.
 */
export async function saveClientAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');

  const parsed = schema.safeParse({
    name: formData.get('name') ?? '',
    phone: formData.get('phone') ?? '',
    password: formData.get('password') ?? '',
    passwordConfirm: formData.get('passwordConfirm') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'generic' };
  const { name, phone, password, passwordConfirm } = parsed.data;

  const existing = await findClientAccount();

  if (!existing && !password) return { error: 'passwordRequired' };
  if (password) {
    if (password.length < MIN_PASSWORD) return { error: 'passwordTooShort' };
    if (password !== passwordConfirm) return { error: 'passwordMismatch' };
  }

  const holder = await prisma.user.findUnique({ where: { phone } });
  if (holder && holder.id !== existing?.id) return { error: 'phoneTaken' };

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        phone,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      },
    });
  } else {
    await prisma.user.create({
      data: {
        name,
        phone,
        passwordHash: await hashPassword(password),
        role: 'CLIENT_SUPERVISOR',
        status: 'APPROVED',
      },
    });
  }

  revalidatePath(`/${locale}/manager/settings`);
  return { ok: existing ? (password ? 'passwordReset' : 'saved') : 'created' };
}

/** Switches the JTI login off (and back on) without losing anything it has done. */
export async function setClientAccessAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');
  const enable = formData.get('enable') === '1';

  const existing = await findClientAccount();
  if (!existing) return { error: 'generic' };

  // REJECTED is what login and getCurrentUser already refuse, so switching off takes
  // effect on the JTI team's very next click, sessions included.
  await prisma.user.update({
    where: { id: existing.id },
    data: { status: enable ? 'APPROVED' : 'REJECTED' },
  });

  revalidatePath(`/${locale}/manager/settings`);
  return { ok: enable ? 'enabled' : 'disabled' };
}
