'use server';

import { requireActionManager } from '@/lib/auth';
import { forecastParts } from '@/lib/analytics';
import { localDayRange } from '@/lib/dates';

export interface ForecastState {
  error?: string;
  result?: {
    basisStandCount: number;
    standCount: number;
    rows: Array<{ nameFa: string; nameEn: string; perStandRate: number; estimatedQuantity: number }>;
  };
}

/** §10 — project parts needed for an upcoming phase from historical consumption. */
export async function forecastAction(
  _prev: ForecastState,
  formData: FormData,
): Promise<ForecastState> {
  try {
    await requireActionManager();

    const standCount = Number(formData.get('standCount'));
    if (!Number.isFinite(standCount) || standCount <= 0) return { error: 'generic' };

    const range = localDayRange(
      (formData.get('from') as string) || null,
      (formData.get('to') as string) || null,
    );

    const { rows, basisStandCount } = await forecastParts(standCount, {
      from: range.from,
      to: range.to,
      cityId: (formData.get('cityId') as string) || undefined,
    });

    return { result: { rows, basisStandCount, standCount } };
  } catch (err) {
    console.error('forecastAction failed', err);
    return { error: 'generic' };
  }
}
