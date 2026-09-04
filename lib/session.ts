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

export type SessionRole = 'TECHNICIAN' | 'MANAGER';

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
    if (!userId || (role !== 'TECHNICIAN' && role !== 'MANAGER')) return null;
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
