'use client';

import clsx from 'clsx';
import { useActionState, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { submitRepairFormAction, type RepairFormState } from '@/app/actions/repair-form';
import { Link } from '@/i18n/navigation';

import { PartPicker, type PartOption, type PartSelection } from './PartPicker';
import { ExtraPhotoInput, PhotoInput } from './PhotoInput';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from './ui';

/** §6.5 — fixed list; a developer extends it, never a user. */
export const NOT_REPAIRED_REASONS = [
  'MANAGER_NOT_AUTHORIZED',
  'STORE_OR_STAND_REMOVED',
  'ALREADY_HEALTHY',
  'STORE_TEMPORARILY_CLOSED',
  'CONDITION_TOO_POOR',
] as const;

export interface RepairFormProps {
  locale: string;
  uid: string;
  technicianName: string;
  technicianCode: string | null;
  technicianPhone: string;
  todayLabel: string;
  parts: PartOption[];
  cities: Array<{ id: string; name: string }>;
  prefill: {
    storeName: string;
    storeAddress: string;
    storeManagerName: string;
    storePhone: string;
    digitalAddress: string;
    cityId: string | null;
  };
  isUnmatched: boolean;
  wouldBeReRepair: boolean;
}

export function RepairFormClient(props: RepairFormProps) {
  const t = useTranslations('form');
  const tr = useTranslations('reasons');
  const tt = useTranslations('technician');
  const tc = useTranslations('common');

  const [state, formAction] = useActionState<RepairFormState, FormData>(
    submitRepairFormAction,
    {},
  );
  const [pending, startTransition] = useTransition();

  const [replaced, setReplaced] = useState<PartSelection>({});
  const [repaired, setRepaired] = useState<PartSelection>({});
  const [quality, setQuality] = useState<number | null>(null);
  const [reason, setReason] = useState<string>('');
  const [digitalAddress, setDigitalAddress] = useState(props.prefill.digitalAddress);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const techSig = useRef<SignaturePadHandle | null>(null);
  const mgrSig = useRef<SignaturePadHandle | null>(null);

  // §6.1 — the outcome is derived from the parts, never chosen. The UI mirrors the
  // server rule so the technician sees the consequence of their input immediately.
  const hasParts = Object.keys(replaced).length + Object.keys(repaired).length > 0;
  const outcome = hasParts ? 'REPAIRED' : 'NOT_REPAIRED';

  const captureLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError(t('locationDenied'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setDigitalAddress(`https://maps.google.com/?q=${latitude},${longitude}`);
      },
      () => setGeoError(t('locationDenied')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setClientError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    // Client-side mirrors of the server's guards, so the technician isn't told about a
    // missing signature only after a slow multi-megabyte upload.
    if (!hasParts && !reason) {
      setClientError(t('errors.partsOrReason'));
      return;
    }
    if (hasParts && quality === null) {
      setClientError(t('errors.qualityRequired'));
      return;
    }
    for (const field of ['photoStore', 'photoBefore', 'photoAfter']) {
      const file = formData.get(field);
      if (!(file instanceof File) || file.size === 0) {
        setClientError(t('errors.photosRequired'));
        return;
      }
    }

    const [techBlob, mgrBlob] = await Promise.all([
      techSig.current?.toBlob() ?? Promise.resolve(null),
      mgrSig.current?.toBlob() ?? Promise.resolve(null),
    ]);
    if (!techBlob || !mgrBlob) {
      setClientError(t('errors.signaturesRequired'));
      return;
    }

    formData.set('technicianSignature', techBlob, 'technician-signature.png');
    formData.set('storeManagerSignature', mgrBlob, 'manager-signature.png');
    formData.set('digitalAddress', digitalAddress);
    if (quality !== null) formData.set('qualityScore', String(quality));

    startTransition(() => formAction(formData));
  };

  if (state.success) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <div className="text-4xl">✓</div>
        <h2 className="mt-3 text-lg font-bold text-emerald-700">{t('submitted')}</h2>
        <p className="mt-1 text-sm text-slate-700">
          {t('submittedCode', { code: state.success.formCode })}
        </p>
        {state.success.isReRepair ? (
          <p className="mt-2 text-xs text-amber-700">{tt('reRepairWarning', { days: 14 })}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/technician"
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t('anotherStand')}
          </Link>
        </div>
      </Card>
    );
  }

  const busy = pending;

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-24">
      <input type="hidden" name="uid" value={props.uid} />
      <input type="hidden" name="locale" value={props.locale} />

      {/* ---------------- general ---------------- */}
      <Card>
        <CardHeader title={t('sectionGeneral')} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--muted)]">{tc('uid')}</dt>
            <dd className="dir-ltr font-semibold">{props.uid}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">{t('formCode')}</dt>
            <dd className="text-xs text-slate-500">{t('assignedOnSubmit')}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">{t('technicianCode')}</dt>
            <dd className="dir-ltr font-medium">{props.technicianCode ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">{tc('date')}</dt>
            <dd className="font-medium">{props.todayLabel}</dd>
          </div>
        </dl>
      </Card>

      {/* ---------------- store ---------------- */}
      <Card>
        <CardHeader title={t('sectionStore')} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label={t('storeName')}>
            <Input name="storeName" defaultValue={props.prefill.storeName} />
          </Field>
          <Field label={tc('city')}>
            <Select name="cityId" defaultValue={props.prefill.cityId ?? ''}>
              <option value="">—</option>
              {props.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('storeManagerName')}>
            <Input name="storeManagerName" defaultValue={props.prefill.storeManagerName} />
          </Field>
          <Field label={t('storePhone')}>
            <Input
              name="storePhone"
              dir="ltr"
              className="dir-ltr"
              inputMode="tel"
              defaultValue={props.prefill.storePhone}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('storeAddress')}>
              <Textarea name="storeAddress" defaultValue={props.prefill.storeAddress} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={tc('digitalAddress')} hint={t('digitalAddressHelp')} error={geoError}>
              <div className="flex gap-2">
                <Input
                  value={digitalAddress}
                  onChange={(e) => setDigitalAddress(e.target.value)}
                  dir="ltr"
                  className="dir-ltr"
                  placeholder="https://maps.google.com/?q=..."
                />
                <Button type="button" variant="secondary" onClick={captureLocation}>
                  {t('useMyLocation')}
                </Button>
              </div>
            </Field>
          </div>
        </div>
      </Card>

      {/* ---------------- parts ---------------- */}
      <Alert tone={outcome === 'REPAIRED' ? 'success' : 'warning'}>
        <span className="font-semibold">
          {outcome === 'REPAIRED' ? t('outcomeRepaired') : t('outcomeNotRepaired')}
        </span>
        <span className="block text-xs">{t('outcomeAuto')}</span>
      </Alert>

      <PartPicker
        parts={props.parts}
        action="REPLACED"
        fieldName="parts"
        title={t('replacedParts')}
        help={t('replacedHelp')}
        value={replaced}
        onChange={setReplaced}
      />
      <PartPicker
        parts={props.parts}
        action="REPAIRED"
        fieldName="parts"
        title={t('repairedParts')}
        help={t('repairedHelp')}
        value={repaired}
        onChange={setRepaired}
      />

      {!hasParts ? (
        <Card>
          <CardHeader title={t('notRepairedReason')} />
          <div className="space-y-2 p-4">
            {NOT_REPAIRED_REASONS.map((r) => (
              <label
                key={r}
                className={clsx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm',
                  reason === r
                    ? 'border-brand-400 bg-brand-50'
                    : 'border-[var(--border)] bg-white',
                )}
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
        </Card>
      ) : null}

      {/* ---------------- quality + time ---------------- */}
      <Card>
        <CardHeader title={t('sectionQuality')} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {hasParts ? (
            <Field label={t('qualityScore')} hint={t('qualityHelp')} required>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQuality(n)}
                    className={clsx(
                      'h-11 flex-1 rounded-lg border text-sm font-semibold transition-colors',
                      quality === n
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-[var(--border)] bg-white text-slate-700 hover:bg-brand-50',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          <Field label={t('timeSpent')}>
            <Input
              name="timeSpentMinutes"
              type="number"
              min={0}
              max={1440}
              inputMode="numeric"
              dir="ltr"
              className="dir-ltr"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label={tc('notes')}>
              <Textarea name="notes" placeholder={t('notesPlaceholder')} />
            </Field>
          </div>
        </div>
      </Card>

      {/* ---------------- photos ---------------- */}
      <Card>
        <CardHeader title={t('sectionPhotos')} description={t('photosHelp')} />
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <PhotoInput label={t('photoStore')} name="photoStore" required />
          <PhotoInput label={t('photoBefore')} name="photoBefore" required />
          <PhotoInput label={t('photoAfter')} name="photoAfter" required />
          <div className="sm:col-span-3">
            <ExtraPhotoInput name="photoOther" />
          </div>
        </div>
      </Card>

      {/* ---------------- signatures ---------------- */}
      <Card>
        <CardHeader title={t('sectionSignatures')} />
        <div className="grid gap-5 p-4 sm:grid-cols-2">
          <SignaturePad ref={techSig} label={t('technicianSignature')} />
          <SignaturePad ref={mgrSig} label={t('storeManagerSignature')} />
        </div>
      </Card>

      {clientError ? <Alert tone="danger">{clientError}</Alert> : null}
      {state.error ? (
        <Alert tone="danger">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : tc('error')}
        </Alert>
      ) : null}

      {/* Sticky on mobile: the form is long and the submit must always be reachable. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-7xl">
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? tc('submitting') : t('submitReport')}
          </Button>
        </div>
      </div>
    </form>
  );
}
