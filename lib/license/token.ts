/**
 * The license file format, shared by the app (which only verifies) and
 * `scripts/license.ts` (which also signs).
 *
 * A license is an Ed25519-signed JWS wrapped in BEGIN/END lines so it survives being
 * pasted through a messenger. The private key that signs it never leaves the vendor's
 * machine; the app carries only the public key, so it can tell a real license from a
 * forged one but cannot mint one.
 */

import { compactVerify, importSPKI } from 'jose';

import { LICENSE_PUBLIC_KEY } from './public-key';

export const LICENSE_ALG = 'EdDSA';
export const LICENSE_ISSUER = 'sazkara-license';

const BEGIN = '-----BEGIN SAZKARA LICENSE-----';
const END = '-----END SAZKARA LICENSE-----';

export interface LicenseClaims {
  iss: string;
  /** Who the license is for, e.g. "Sazkara". */
  sub: string;
  /** Unique id, so two licenses for the same dates can still be told apart. */
  jti: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. Absent on a permanent license. */
  exp?: number;
  note?: string;
}

export class LicenseFormatError extends Error {}

/** Wraps a compact JWS in the pasteable block. */
export function armorLicense(jws: string): string {
  const lines = jws.match(/.{1,64}/g) ?? [jws];
  return [BEGIN, ...lines, END].join('\n');
}

/** Accepts the armored block, or the bare token, with any whitespace a paste added. */
export function unarmorLicense(text: string): string {
  return text.replace(BEGIN, '').replace(END, '').replace(/\s+/g, '');
}

let publicKey: Promise<CryptoKey> | null = null;

/**
 * Checks the signature and returns the claims. Deliberately does NOT check expiry: the
 * caller decides what "now" is (see the clock guard in `state.ts`) and still needs the
 * claims of an expired license to say when it ran out.
 */
export async function verifyLicense(text: string): Promise<LicenseClaims> {
  const token = unarmorLicense(text);
  if (!token) throw new LicenseFormatError('empty');

  publicKey ??= importSPKI(LICENSE_PUBLIC_KEY, LICENSE_ALG);

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(token, await publicKey, {
      algorithms: [LICENSE_ALG],
    }));
  } catch {
    throw new LicenseFormatError('signature');
  }

  const claims = JSON.parse(new TextDecoder().decode(payload)) as LicenseClaims;
  if (claims.iss !== LICENSE_ISSUER || typeof claims.sub !== 'string') {
    throw new LicenseFormatError('claims');
  }
  return claims;
}
