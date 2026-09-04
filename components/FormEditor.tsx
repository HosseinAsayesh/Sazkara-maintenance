'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import {
  deleteRepairFormAction,
  updateRepairFormAction,
  type ActionState,
} from '@/app/actions/forms';

import { JalaliDateInput } from './JalaliDateInput';
import { PartPicker, type PartOption, type PartSelection } from './PartPicker';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from './ui';

export interface EditableForm {
  id: string;
  formCode: string;
  uid: string;
  standIndex: number;
  date: string;
  cityId: string | null;
  storeName: string | null;
  storeAddress: string | null;
  storeManagerName: string | null;
  storePhone: string | null;
  digitalAddress: string | null;
  timeSpentMinutes: number | null;
  qualityScore: number | null;
  notes: string | null;
  outcome: string;
  notRepairedReason: string | null;
  isReRepair: boolean;
  technicianCode: string | null;
  replaced: PartSelection;
  repaired: PartSelection;
  photoUrls: Array<{ type: string; url: string }>;
}

const NOT_REPAIRED_REASONS = [
  'MANAGER_NOT_AUTHORIZED',
  'STORE_OR_STAND_REMOVED',
  'ALREADY_HEALTHY',
  'STORE_TEMPORARILY_CLOSED',
  'CONDITION_TOO_POOR',
] as const;

/**
 * Manager view of one submitted report, with correction and deletion.
 *
 * Photos and signatures are shown but not editable: re-capturing them needs the
 * technician to be at the store, so the honest remedy for bad evidence is to delete the
 * report and have it filed again — which is also what puts the uid back in the queue.
 */
export function FormEditor({
  locale,
  form,
  parts,
  cities,
}: {
  locale: string;
  form: EditableForm;
  parts: PartOption[];
  cities: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('formView');
  const tf = useTranslations('form');
  const tr = useTranslations('reasons');
  const tc = useTranslations('common');
  const tErr = useTranslations('errors');

  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(
    updateRepairFormAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteRepairFormAction,
    {},
  );

  const [replaced, setReplaced] = useState<PartSelection>(form.replaced);
  const [repaired, setRepaired] = useState<PartSelection>(form.repaired);
  const [date, setDate] = useState(form.date);
  const [quality, setQuality] = useState<number | null>(form.qualityScore);
  const [reason, setReason] = useState(form.notRepairedReason ?? '');

  const hasParts = Object.keys(replaced).length + Object.keys(repaired).length > 0;

  const err = (state: ActionState) =>
    state.error ? (
      <Alert tone="danger">
        {tErr.has(state.error) ? tErr(state.error) : tc('error')}
      </Alert>
    ) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${form.formCode} · ${form.uid}`}
          description={t('editHelp')}
          action={
            <form
              action={deleteAction}
              onSubmit={(e) => {
                if (!confirm(t('deleteConfirm'))) e.preventDefault();
              }}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="formId" value={form.id} />
              <Button type="submit" variant="danger" size="sm">
                {t('delete')}
              </Button>
            </form>
          }
        />
        <div className="flex flex-wrap gap-2 p-4">
          <Badge tone={form.outcome === 'REPAIRED' ? 'success' : 'danger'}>
            {form.outcome === 'REPAIRED' ? tf('outcomeRepaired') : tf('outcomeNotRepaired')}
          </Badge>
          {form.isReRepair ? <Badge tone="warning">↻</Badge> : null}
          <Badge tone="neutral">
            {tf('standNumber', { n: form.standIndex })}
          </Badge>
          {form.technicianCode ? (
            <Badge tone="neutral">{form.technicianCode}</Badge>
          ) : null}
          {err(deleteState)}
        </div>
      </Card>

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="formId" value={form.id} />
        <input type="hidden" name="date" value={date} />
        {/* Tells the server the parts in this payload are authoritative, so an empty
            selection means "no parts" rather than "field omitted". */}
        <input type="hidden" name="partsProvided" value="true" />
        {quality !== null ? (
          <input type="hidden" name="qualityScore" value={quality} />
        ) : null}

        <Card>
          <CardHeader title={tf('sectionStore')} />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label={tc('date')}>
              <JalaliDateInput value={date} onChange={setDate} ariaLabel={tc('date')} />
            </Field>
            <Field label={tc('city')}>
              <Select name="cityId" defaultValue={form.cityId ?? ''}>
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tf('storeName')}>
              <Input name="storeName" defaultValue={form.storeName ?? ''} />
            </Field>
            <Field label={tf('storeManagerName')}>
              <Input name="storeManagerName" defaultValue={form.storeManagerName ?? ''} />
            </Field>
            <Field label={tf('storePhone')}>
              <Input
                name="storePhone"
                defaultValue={form.storePhone ?? ''}
                className="dir-ltr"
              />
            </Field>
            <Field label={tf('timeSpent')}>
              <Input
                name="timeSpentMinutes"
                type="number"
                min={0}
                max={1440}
                defaultValue={form.timeSpentMinutes ?? ''}
                className="dir-ltr"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={tf('storeAddress')}>
                <Textarea name="storeAddress" defaultValue={form.storeAddress ?? ''} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={tc('digitalAddress')}>
                <Input
                  name="digitalAddress"
                  defaultValue={form.digitalAddress ?? ''}
                  className="dir-ltr"
                />
              </Field>
            </div>
          </div>
        </Card>

        <PartPicker
          parts={parts}
          action="REPLACED"
          fieldName="parts"
          title={tf('replacedParts')}
          help={tf('replacedHelp')}
          value={replaced}
          onChange={setReplaced}
        />
        <PartPicker
          parts={parts}
          action="REPAIRED"
          fieldName="parts"
          title={tf('repairedParts')}
          help={tf('repairedHelp')}
          value={repaired}
          onChange={setRepaired}
        />

        <Card>
          <CardHeader title={tf('sectionQuality')} />
          <div className="grid gap-4 p-4">
            {hasParts ? (
              <Field label={tf('qualityScore')}>
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQuality(n)}
                      className={
                        quality === n
                          ? 'h-11 flex-1 rounded-lg border border-brand-600 bg-brand-600 text-sm font-semibold text-white'
                          : 'h-11 flex-1 rounded-lg border border-[var(--border)] bg-white text-sm font-semibold text-slate-700 hover:bg-brand-50'
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <Field label={tf('notRepairedReason')} required>
                <div className="space-y-2">
                  {NOT_REPAIRED_REASONS.map((r) => (
                    <label
                      key={r}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border)] p-2.5 text-sm"
                    >
                      <input
                        type="radio"
                        name="notRepairedReason"
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        className="mt-0.5"
                      />
                      <span>{tr(r)}</span>
                    </label>
                  ))}
                </div>
              </Field>
            )}

            <Field label={tc('notes')}>
              <Textarea name="notes" defaultValue={form.notes ?? ''} />
            </Field>
          </div>
        </Card>

        {err(saveState)}
        {saveState.ok ? <Alert tone="success">{t('formSaved')}</Alert> : null}

        <Button type="submit" disabled={saving}>
          {saving ? tc('saving') : tc('save')}
        </Button>
      </form>

      <Card>
        <CardHeader title={tf('sectionPhotos')} description={t('cannotEditPhotos')} />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {form.photoUrls.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">—</p>
          ) : (
            form.photoUrls.map((photo) => (
              <a
                key={photo.url}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-[var(--border)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.type} className="h-32 w-full object-cover" />
                <span className="block px-2 py-1 text-xs text-[var(--muted)]">
                  {photo.type}
                </span>
              </a>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
