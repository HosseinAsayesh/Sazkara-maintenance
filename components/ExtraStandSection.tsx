'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';

import { PartPicker, type PartOption, type PartSelection } from './PartPicker';
import { PhotoInput } from './PhotoInput';
import { Button, Card, CardHeader, Field, Input, Textarea } from './ui';

/** §6.5 — the same fixed list the primary stand uses. */
const NOT_REPAIRED_REASONS = [
  'MANAGER_NOT_AUTHORIZED',
  'STORE_OR_STAND_REMOVED',
  'ALREADY_HEALTHY',
  'STORE_TEMPORARILY_CLOSED',
  'CONDITION_TOO_POOR',
] as const;

export interface ExtraStandValue {
  uid: string;
  replaced: PartSelection;
  repaired: PartSelection;
  quality: number | null;
  reason: string;
}

export const emptyExtraStand = (): ExtraStandValue => ({
  uid: '',
  replaced: {},
  repaired: {},
  quality: null,
  reason: '',
});

/**
 * One additional stand at the same store ("double stands", §6.6).
 *
 * A store can carry two or three stands, each with its own Jti uid, and the technician
 * services them on a single trip. Rather than making them re-enter the store details and
 * sign again for each, this panel captures only what is genuinely per-stand: the uid, the
 * parts, the quality score and its own before/after photos. The store block, both
 * signatures and the store photo are shared with the primary stand.
 *
 * On the server each of these still becomes its own RepairForm, because the Jti export is
 * one row per stand and the wage tier depends on service order.
 */
export function ExtraStandSection({
  index,
  parts,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  parts: PartOption[];
  value: ExtraStandValue;
  onChange: (next: ExtraStandValue) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('form');
  const tr = useTranslations('reasons');
  const tc = useTranslations('common');

  const hasParts =
    Object.keys(value.replaced).length + Object.keys(value.repaired).length > 0;

  const set = <K extends keyof ExtraStandValue>(key: K, next: ExtraStandValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <Card className="border-brand-200">
      <CardHeader
        title={t('standNumber', { n: index + 2 })}
        description={t('secondStand')}
        action={
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('removeStand')}
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        <Field label={tc('uid')} required>
          <Input
            name={`extra_${index}_uid`}
            value={value.uid}
            onChange={(e) => set('uid', e.target.value)}
            dir="ltr"
            className="dir-ltr"
            required
          />
        </Field>

        <PartPicker
          parts={parts}
          action="REPLACED"
          fieldName={`extra_${index}_parts`}
          title={t('replacedParts')}
          help={t('replacedHelp')}
          value={value.replaced}
          onChange={(next) => set('replaced', next)}
        />
        <PartPicker
          parts={parts}
          action="REPAIRED"
          fieldName={`extra_${index}_parts`}
          title={t('repairedParts')}
          help={t('repairedHelp')}
          value={value.repaired}
          onChange={(next) => set('repaired', next)}
        />

        {hasParts ? (
          <Field label={t('qualityScore')} required>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set('quality', n)}
                  className={clsx(
                    'h-11 flex-1 rounded-lg border text-sm font-semibold transition-colors',
                    value.quality === n
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-[var(--border)] bg-white text-slate-700 hover:bg-brand-50',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            {value.quality !== null ? (
              <input
                type="hidden"
                name={`extra_${index}_quality`}
                value={value.quality}
              />
            ) : null}
          </Field>
        ) : (
          <Field label={t('notRepairedReason')} required>
            <div className="space-y-2">
              {NOT_REPAIRED_REASONS.map((r) => (
                <label
                  key={r}
                  className={clsx(
                    'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm',
                    value.reason === r
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-[var(--border)] bg-white',
                  )}
                >
                  <input
                    type="radio"
                    name={`extra_${index}_reason`}
                    value={r}
                    checked={value.reason === r}
                    onChange={() => set('reason', r)}
                    className="mt-0.5"
                  />
                  <span>{tr(r)}</span>
                </label>
              ))}
            </div>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <PhotoInput
            label={t('photoBefore')}
            name={`extra_${index}_photoBefore`}
            required
          />
          <PhotoInput
            label={t('photoAfter')}
            name={`extra_${index}_photoAfter`}
            required
          />
          <Field label={t('timeSpent')}>
            <Input
              name={`extra_${index}_time`}
              type="number"
              min={0}
              max={1440}
              inputMode="numeric"
              dir="ltr"
              className="dir-ltr"
            />
          </Field>
        </div>

        <Field label={tc('notes')}>
          <Textarea name={`extra_${index}_notes`} />
        </Field>
      </div>
    </Card>
  );
}
