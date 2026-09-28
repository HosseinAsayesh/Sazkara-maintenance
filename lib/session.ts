/**
 * Session token handling — Edge-safe.
 *
 * The spec allows "NextAuth or an equivalent lightweight session library"; this is the
 * lightweight route: a signed JWT in an httpOnly cookie, verified with `jose`, which
 * runs unchanged in both the Edge middleware and Node server components. Password
 * hashing (bcrypt, Node-only) deliberately lives in `lib/auth.ts` so the middleware
 * bundle never pulls it in.
 */

import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'sazkara_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Every role a cookie may carry — and the runtime allowlist, from one source.
 *
 * These were two separate lists: a union type here and a hardcoded array inside
 * verifySession. Adding CLIENT_SUPERVISOR to the type while missing the array meant
 * every Jti session verified as forged and was bounced to the login page, with the
 * account itself perfectly valid. A union derived from the array cannot drift from it.
 */
export const SESSION_ROLES = [
  'TECHNICIAN',
  'LEAD_TECHNICIAN',
  'MANAGER',
  'CLIENT_SUPERVISOR',
] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

export interface SessionPayload {
  userId: string;
  name: string;
  phone: string;
  role: SessionRole;
  technicianCode: string | null;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Set a random 32+ character value in .env ' +
        '(see .env.example).',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    const { userId, name, phone, role, technicianCode } = payload as unknown as SessionPayload;
    if (!userId || !SESSION_ROLES.includes(role)) {
      return null;
    }
    return { userId, name, phone, role, technicianCode: technicianCode ?? null };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
  secure: process.env.NODE_ENV === 'production',
} as const;
