/**
 * Server-side auth helpers (Node runtime only — pulls in bcrypt and Prisma).
 */

import 'server-only';

import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { prisma } from './prisma';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
  type SessionPayload,
} from './session';

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Iranian mobile numbers arrive as 0912…, +98912…, ۰۹۱۲… — store one canonical form. */
export function normalisePhone(raw: string): string {
  const latin = raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const digits = latin.replace(/[^\d+]/g, '');
  if (digits.startsWith('+98')) return `0${digits.slice(3)}`;
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (!digits.startsWith('0') && digits.length === 10) return `0${digits}`;
  return digits;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}

/**
 * Re-reads the user so a revoked/rejected account stops working immediately instead of
 * living until the JWT expires.
 */
export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== 'APPROVED') return null;
  return user;
}

export async function requireUser(locale: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

/** Where a signed-in user belongs, so a wrong-role visit lands somewhere useful. */
export function homeFor(role: string, locale: string): string {
  if (role === 'MANAGER') return `/${locale}/manager`;
  if (role === 'LEAD_TECHNICIAN') return `/${locale}/lead`;
  return `/${locale}/technician`;
}

export async function requireManager(locale: string) {
  const user = await requireUser(locale);
  if (user.role !== 'MANAGER') redirect(homeFor(user.role, locale));
  return user;
}

export async function requireTechnician(locale: string) {
  const user = await requireUser(locale);
  if (user.role !== 'TECHNICIAN') redirect(homeFor(user.role, locale));
  return user;
}

/**
 * A crew lead. Deliberately NOT a junior manager: this guard gates the /lead area only,
 * which exposes their own crew's work and nothing else. A manager is allowed in so they
 * can see what a lead sees without a second account.
 */
export async function requireLead(locale: string) {
  const user = await requireUser(locale);
  if (user.role !== 'LEAD_TECHNICIAN' && user.role !== 'MANAGER') {
    redirect(homeFor(user.role, locale));
  }
  return user;
}

/**
 * Server-action variants. Actions can't redirect a failed authorisation usefully (the
 * caller is a fetch, not a navigation), so these throw a plain Error the action wrapper
 * turns into an error state.
 */
export async function requireActionUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}

export async function requireActionManager() {
  const user = await requireActionUser();
  if (user.role !== 'MANAGER') throw new Error('FORBIDDEN');
  return user;
}

export async function requireActionLead() {
  const user = await requireActionUser();
  if (user.role !== 'LEAD_TECHNICIAN' && user.role !== 'MANAGER') {
    throw new Error('FORBIDDEN');
  }
  return user;
}

/** API-route variants: throw a 401/403 Response instead of redirecting. */
export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return user;
}

export async function requireApiManager() {
  const user = await requireApiUser();
  if (user.role !== 'MANAGER') {
    throw Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  return user;
}

/** A lead (or manager) for API routes that serve crew data. */
export async function requireApiLead() {
  const user = await requireApiUser();
  if (user.role !== 'LEAD_TECHNICIAN' && user.role !== 'MANAGER') {
    throw Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  return user;
}
