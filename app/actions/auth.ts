'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  clearSessionCookie,
  hashPassword,
  normalisePhone,
  setSessionCookie,
  verifyPassword,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export interface AuthState {
  error?: string;
  /** Translation key under the `auth.errors` namespace. */
  field?: string;
}

const phoneSchema = z
  .string()
  .transform(normalisePhone)
  .refine((v) => /^0\d{10}$/.test(v), { message: 'invalidPhone' });

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'invalidCredentials'),
});

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    phone: formData.get('phone'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'invalidCredentials' };
  }

  const locale = String(formData.get('locale') || 'fa');
  const user = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });

  // Same generic error whether the phone is unknown or the password is wrong, so the
  // form can't be used to enumerate who has an account.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: 'invalidCredentials' };
  }

  if (user.status === 'PENDING') return { error: 'pending' };
  if (user.status === 'REJECTED') return { error: 'rejected' };

  await setSessionCookie({
    userId: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    technicianCode: user.technicianCode,
  });

  const next = String(formData.get('next') || '');
  const fallback = user.role === 'MANAGER' ? `/${locale}/manager` : `/${locale}/technician`;
  // Only follow same-origin relative paths — never an attacker-supplied absolute URL.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : fallback);
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'nameRequired'),
    phone: phoneSchema,
    password: z.string().min(6, 'passwordTooShort'),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: 'passwordMismatch',
    path: ['passwordConfirm'],
  });

export async function registerAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'generic' };
  }

  const locale = String(formData.get('locale') || 'fa');
  const existing = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });
  if (existing) return { error: 'phoneTaken' };

  // §4.1 — created PENDING; the account cannot log in until a manager approves it and
  // assigns a technician code.
  await prisma.user.create({
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone,
      passwordHash: await hashPassword(parsed.data.password),
      role: 'TECHNICIAN',
      status: 'PENDING',
    },
  });

  redirect(`/${locale}/pending`);
}

export async function logoutAction(formData: FormData) {
  const locale = String(formData.get('locale') || 'fa');
  await clearSessionCookie();
  redirect(`/${locale}/login`);
}
