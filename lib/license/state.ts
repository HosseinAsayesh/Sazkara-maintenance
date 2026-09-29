/**
 * Works out whether the app may currently write.
 *
 * Takes the *unguarded* Prisma client as a parameter rather than importing `lib/prisma`,
 * because the guard in `lib/prisma` depends on this module — importing back would be a
 * cycle, and the license's own bookkeeping must never be blocked by the license.
 */

import type { PrismaClient } from '@prisma/client';

import { DAY_MS } from '../dates';
import { LicenseFormatError, verifyLicense, type LicenseClaims } from './token';

export const LICENSE_KEY = 'license.token';
/** Latest time the app has ever seen — the clock guard. */
const LAST_SEEN_KEY = 'license.lastSeen';

/** How early managers start seeing the "expires soon" banner. */
export const WARNING_DAYS = 14;

const CACHE_MS = 60_000;
/** Don't rewrite the high-water mark on every check. */
const LAST_SEEN_STEP_MS = 10 * 60_000;

export type LicenseStatus = 'valid' | 'expiring' | 'expired' | 'missing' | 'invalid';

export interface LicenseState {
  status: LicenseStatus;
  /** True when writes are refused. Only ever true in a production build. */
  readOnly: boolean;
  licensee: string | null;
  /** null for a permanent license (or when there is no usable license). */
  expiresAt: Date | null;
  /** Whole days until expiry, rounded up; null when there is no expiry. */
  daysLeft: number | null;
}

/**
 * Only a production build enforces. `next dev` and the tsx scripts run on the
 * developer's machine, where a lock would only get in the developer's way; `next build`
 * inlines NODE_ENV, so the shipped server cannot be talked out of it with an env var.
 * LICENSE_ENFORCE=1 can only switch enforcement *on*, to try the lock out in dev.
 */
export const LICENSE_ENFORCED =
  process.env.NODE_ENV === 'production' || process.env.LICENSE_ENFORCE === '1';

let cache: { state: LicenseState; at: number } | null = null;

export function invalidateLicenseCache() {
  cache = null;
}

/**
 * "Now", but never earlier than any moment the app has already seen. Winding the server
 * clock back therefore cannot un-expire a license.
 */
async function trustedNow(db: PrismaClient): Promise<Date> {
  const now = Date.now();
  const row = await db.appSetting.findUnique({ where: { key: LAST_SEEN_KEY } });
  const lastSeen = row ? Date.parse(row.value) || 0 : 0;

  if (now > lastSeen + LAST_SEEN_STEP_MS) {
    const value = new Date(now).toISOString();
    await db.appSetting.upsert({
      where: { key: LAST_SEEN_KEY },
      create: { key: LAST_SEEN_KEY, value },
      update: { value },
    });
  }
  return new Date(Math.max(now, lastSeen));
}

export function evaluateClaims(claims: LicenseClaims, now: Date): LicenseState {
  if (claims.exp === undefined) {
    return { status: 'valid', readOnly: false, licensee: claims.sub, expiresAt: null, daysLeft: null };
  }
  const expiresAt = new Date(claims.exp * 1000);
  const msLeft = expiresAt.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
  const status: LicenseStatus =
    msLeft <= 0 ? 'expired' : daysLeft <= WARNING_DAYS ? 'expiring' : 'valid';
  return {
    status,
    readOnly: LICENSE_ENFORCED && status === 'expired',
    licensee: claims.sub,
    expiresAt,
    daysLeft,
  };
}

async function compute(db: PrismaClient): Promise<LicenseState> {
  const now = await trustedNow(db);
  const row = await db.appSetting.findUnique({ where: { key: LICENSE_KEY } });

  const none = (status: LicenseStatus): LicenseState => ({
    status,
    readOnly: LICENSE_ENFORCED,
    licensee: null,
    expiresAt: null,
    daysLeft: null,
  });

  if (!row?.value) return none('missing');

  try {
    return evaluateClaims(await verifyLicense(row.value), now);
  } catch (err) {
    if (err instanceof LicenseFormatError) return none('invalid');
    throw err;
  }
}

export async function getLicenseState(db: PrismaClient): Promise<LicenseState> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  const state = await compute(db);
  cache = { state, at: Date.now() };
  return state;
}

/** Validates a pasted license against the trusted clock and stores it. */
export async function installLicense(
  db: PrismaClient,
  text: string,
): Promise<{ ok: true; state: LicenseState } | { ok: false; error: 'invalid' | 'expired' }> {
  let claims: LicenseClaims;
  try {
    claims = await verifyLicense(text);
  } catch (err) {
    if (err instanceof LicenseFormatError) return { ok: false, error: 'invalid' };
    throw err;
  }

  const state = evaluateClaims(claims, await trustedNow(db));
  if (state.status === 'expired') return { ok: false, error: 'expired' };

  const value = text.trim();
  await db.appSetting.upsert({
    where: { key: LICENSE_KEY },
    create: { key: LICENSE_KEY, value },
    update: { value },
  });
  invalidateLicenseCache();
  return { ok: true, state };
}
