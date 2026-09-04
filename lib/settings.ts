import 'server-only';

import { prisma } from './prisma';

/* ------------------------------------------------------------------ *
 * Wage settings (§6.6) — manager-editable, never hardcoded.
 * ------------------------------------------------------------------ */

export const WAGE_KEYS = [
  'tehranStandRate',
  'otherCityStandRate',
  'secondStandRate',
  'thirdPlusStandRate',
  'unrepairedVisitRate',
] as const;

export type WageKey = (typeof WAGE_KEYS)[number];

/**
 * Fallbacks used only when a row is missing (a fresh DB before `db:seed`). The seed
 * writes real starting values; the manager edits them in Settings afterwards.
 * Amounts are in Iranian Rial (تومان × 10 — the unit the manager types is whatever
 * they enter; the app never converts).
 */
export const WAGE_DEFAULTS: Record<WageKey, number> = {
  tehranStandRate: 0,
  otherCityStandRate: 0,
  secondStandRate: 0,
  thirdPlusStandRate: 0,
  /**
   * Paid for a visit that produced no repair. The technician travelled to the store
   * regardless — a closed shutter still costs them the trip — so the manager sets a flat
   * call-out rate here. If a temporarily-closed store is revisited later and the stand
   * is actually repaired, that second visit is priced normally by the tier rules.
   */
  unrepairedVisitRate: 0,
};

export type WageSettings = Record<WageKey, number>;

export async function getWageSettings(): Promise<WageSettings> {
  const rows = await prisma.wageSetting.findMany({
    where: { key: { in: [...WAGE_KEYS] } },
  });
  const out = { ...WAGE_DEFAULTS };
  for (const row of rows) {
    out[row.key as WageKey] = Number(row.value);
  }
  return out;
}

export async function setWageSettings(values: Partial<WageSettings>): Promise<void> {
  const entries = Object.entries(values).filter(([k]) =>
    (WAGE_KEYS as readonly string[]).includes(k),
  ) as Array<[WageKey, number]>;

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.wageSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * App settings — strings shown on the PDF cover, etc.
 * ------------------------------------------------------------------ */

export const APP_SETTING_KEYS = [
  'companyName',
  'managerContactEmail',
  'logoRef',
] as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

export const APP_SETTING_DEFAULTS: Record<AppSettingKey, string> = {
  companyName: 'سازکارا',
  managerContactEmail: '',
  logoRef: '',
};

export async function getAppSettings(): Promise<Record<AppSettingKey, string>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...APP_SETTING_KEYS] } },
  });
  const out = { ...APP_SETTING_DEFAULTS };
  for (const row of rows) out[row.key as AppSettingKey] = row.value;
  return out;
}

export async function setAppSettings(
  values: Partial<Record<AppSettingKey, string>>,
): Promise<void> {
  const entries = Object.entries(values).filter(([k]) =>
    (APP_SETTING_KEYS as readonly string[]).includes(k),
  ) as Array<[AppSettingKey, string]>;

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );
}
