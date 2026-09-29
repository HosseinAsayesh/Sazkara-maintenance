import 'server-only';

import { unguardedPrisma } from '../prisma';
import { getLicenseState, installLicense, type LicenseState } from './state';

export type { LicenseState, LicenseStatus } from './state';
export { WARNING_DAYS } from './state';
export { LicenseReadOnlyError } from './guard';

export function currentLicense(): Promise<LicenseState> {
  return getLicenseState(unguardedPrisma);
}

export function installLicenseText(text: string) {
  return installLicense(unguardedPrisma, text);
}
