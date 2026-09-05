'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import {
  addCityAction,
  deleteCityAction,
  mergeCitiesAction,
  toggleCityTehranAction,
  type ActionState,
} from '@/app/actions/manager';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
} from './ui';

export interface CityRow {
  id: string;
  name: string;
  nameEn: string | null;
  isTehran: boolean;
  stores: number;
  forms: number;
  evidence: number;
  orderLines: number;
}

/**
 * City list with merge, delete and the Tehran wage flag.
 *
 * Merging exists because duplicate cities are not cosmetic: Tehran is its own wage bucket
 * (§6.6) and its own reporting column, so a stray `Tehran` sitting beside `تهران` splits
 * the payroll split and the dashboard's city breakdown. Suspected duplicates are
 * surfaced at the top rather than left for the manager to spot.
 */
export function CityManager({
  locale,
  cities,
  duplicateGroups,
}: {
  locale: string;
  cities: CityRow[];
  /** Groups of ids that normalise to the same city. */
  duplicateGroups: string[][];
}) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const tErr = useTranslations('errors');

  const [addState, addAction, adding] = useActionState<ActionState, FormData>(
    addCityAction,
    {},
  );
  const [mergeState, mergeAction, merging] = useActionState<ActionState, FormData>(
    mergeCitiesAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteCityAction,
    {},
  );

  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');

  const byId = new Map(cities.map((c) => [c.id, c]));
  const flagged = new Set(duplicateGroups.flat());
  const usage = (c: CityRow) => c.stores + c.forms + c.evidence;

  const err = (state: ActionState) =>
    state.error ? (
      <Alert tone="danger">
        {tErr.has(state.error) ? tErr(state.error) : tc('error')}
      </Alert>
    ) : null;

  return (
    <Card>
      <CardHeader title={t('citiesTitle')} description={t('citiesHelp')} />

      {duplicateGroups.length ? (
        <div className="px-4 pt-4">
          <Alert tone="warning" title={t('duplicateCities')}>
            <span className="block text-xs">{t('duplicateCitiesHelp')}</span>
            <ul className="mt-2 space-y-1 text-xs">
              {duplicateGroups.map((group, i) => (
                <li key={i}>
                  {group
                    .map((id) => byId.get(id))
                    .filter(Boolean)
                    .map((c) => `${c!.name}${c!.nameEn ? ` (${c!.nameEn})` : ''}`)
                    .join('  ·  ')}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      <ul className="divide-y divide-[var(--border)]">
        {cities.map((city) => (
          <li key={city.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{city.name}</span>
              {city.nameEn ? (
                <span className="text-xs text-[var(--muted)] dir-ltr">{city.nameEn}</span>
              ) : null}
              {flagged.has(city.id) ? (
                <Badge tone="warning">{t('possibleDuplicate')}</Badge>
              ) : null}
              <span className="text-xs text-[var(--muted)]">
                {city.stores} · {city.forms} · {city.orderLines}
              </span>
            </span>

            {/* Tehran is a pricing bucket, not a name — the flag is what the split reads. */}
            <form action={toggleCityTehranAction}>
              <input type="hidden" name="cityId" value={city.id} />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="isTehran" value={city.isTehran ? 'false' : 'true'} />
              <button
                type="submit"
                className={
                  city.isTehran
                    ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-full border border-[var(--border)] px-3 py-1 text-xs text-slate-600 hover:bg-brand-50'
                }
              >
                {t('isTehran')}
              </button>
            </form>

            {/* Only an unreferenced city can be deleted; anything else must be merged. */}
            {usage(city) === 0 ? (
              <form action={deleteAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="cityId" value={city.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {tc('delete')}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-[var(--border)] p-4">
        <h3 className="text-sm font-semibold text-brand-900">{t('mergeTitle')}</h3>
        <p className="text-xs text-[var(--muted)]">{t('mergeHelp')}</p>

        <form
          action={mergeAction}
          onSubmit={(e) => {
            const source = byId.get(sourceId);
            const target = byId.get(targetId);
            if (!source || !target) return;
            if (
              !confirm(
                t('mergeConfirm', {
                  source: source.name,
                  target: target.name,
                  count: usage(source),
                }),
              )
            ) {
              e.preventDefault();
            }
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="locale" value={locale} />

          <div className="min-w-[10rem] flex-1">
            <Field label={t('mergeSource')}>
              <Select
                name="sourceId"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                required
              >
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({usage(c)})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="min-w-[10rem] flex-1">
            <Field label={t('mergeTarget')}>
              <Select
                name="targetId"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                required
              >
                <option value="">—</option>
                {cities
                  .filter((c) => c.id !== sourceId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>

          <Button
            type="submit"
            variant="secondary"
            disabled={merging || !sourceId || !targetId || sourceId === targetId}
          >
            {merging ? tc('saving') : t('mergeAction')}
          </Button>
        </form>

        {err(mergeState)}
        {err(deleteState)}
        {mergeState.ok ? <Alert tone="success">{t('merged')}</Alert> : null}
      </div>

      <form
        action={addAction}
        className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] p-4"
      >
        <input type="hidden" name="locale" value={locale} />
        <div className="min-w-[12rem] flex-1">
          <Field label={t('cityName')} required>
            <Input name="cityName" required />
          </Field>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="isTehran" />
          {t('isTehran')}
        </label>
        <Button type="submit" variant="secondary" disabled={adding}>
          {t('addCity')}
        </Button>
        {addState.ok ? (
          <span className="pb-2 text-sm text-emerald-700">{t('saved')}</span>
        ) : null}
      </form>
    </Card>
  );
}
