'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import { installLicenseText } from '@/lib/license';

import type { ActionState } from './manager';

/** Installs a pasted license. Works while read-only — it is how read-only ends. */
export async function installLicenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionManager();
  const locale = String(formData.get('locale') || 'fa');
  const text = String(formData.get('license') ?? '');

  if (!text.trim()) return { error: 'licenseEmpty' };

  const result = await installLicenseText(text);
  if (!result.ok) {
    return { error: result.error === 'expired' ? 'licenseExpired' : 'licenseInvalid' };
  }

  // Every layout carries the banner, so refresh the whole locale tree.
  revalidatePath(`/${locale}`, 'layout');
  return { ok: 'licenseInstalled' };
}
