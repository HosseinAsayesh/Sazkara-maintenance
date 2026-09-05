'use client';

import clsx from 'clsx';
import { useActionState, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { submitRepairFormAction, type RepairFormState } from '@/app/actions/repair-form';
import { Link } from '@/i18n/navigation';

import {
  ExtraStandSection,
  emptyExtraStand,
  type ExtraStandValue,
} from './ExtraStandSection';
import { PartPicker, type PartOption, type PartSelection } from './PartPicker';
import { ExtraPhotoInput, PhotoInput } from './PhotoInput';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { StandTabs } from './StandTabs';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from './ui';

/** A store may carry up to three stands (§6.6). */
const MAX_STANDS = 3;

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
  /** Stands already on file at this location — the form starts pre-expanded to match. */
  knownStandCount: number;
  /** Stand positions already repaired in this campaign; reporting them again is a re-repair. */
  repairedStandIndexes: number[];
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
  /**
   * §6.6 — the other stands at this same location. They share the store's uid, so they
   * are identified by position. The form opens with one block per stand already on file,
   * so a technician arriving at a known three-stand store does not have to remember to
   * add them.
   */
  const [extraStands, setExtraStands] = useState<ExtraStandValue[]>(() =>
    Array.from({ length: Math.max(0, props.knownStandCount - 1) }, emptyExtraStand),
  );
  /** Which stand's panel is on screen. 0 is the primary stand, i+1 is extraStands[i]. */
  const [activeStand, setActiveStand] = useState(0);

  const techSig = useRef<SignaturePadHandle | null>(null);
  const mgrSig = useRef<SignaturePadHandle | null>(null);

  // §6.1 — the outcome is derived from the parts, never chosen. The UI mirrors the
  // server rule so the technician sees the consequence of their input immediately.
  const hasParts = Object.keys(replaced).length + Object.keys(repaired).length > 0;
  const outcome = hasParts ? 'REPAIRED' : 'NOT_REPAIRED';

  const standCount = 1 + extraStands.length;
  const standTabs = [
    { label: t('standNumber', { n: 1 }), ready: hasParts || Boolean(reason) },
    ...extraStands.map((stand, i) => ({
      label: t('standNumber', { n: i + 2 }),
      ready:
        Object.keys(stand.replaced).length + Object.keys(stand.repaired).length > 0 ||
        Boolean(stand.reason),
    })),
  ];

  /**
   * Surfaces a validation failure on the stand it belongs to. With the panels switched
   * rather than stacked, an error about stand 2 is invisible while stand 1 is on screen,
   * so the message alone would leave the technician with nothing to act on.
   */
  const failOn = (standIndex: number, message: string) => {
    setActiveStand(standIndex);
    setClientError(message);
  };

  const addStand = () => {
    setExtraStands((prev) => [...prev, emptyExtraStand()]);
    setActiveStand(standCount); // the tab the new stand will occupy
  };

  const removeStand = (i: number) => {
    setExtraStands((prev) => prev.filter((_, j) => j !== i));
    // Removing the stand on screen, or one before it, would otherwise leave the tab
    // index pointing past the end or at the wrong panel.
    setActiveStand((current) => (current > i ? current - 1 : current));
  };

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
      failOn(0, t('errors.partsOrReason'));
      return;
    }
    if (hasParts && quality === null) {
      failOn(0, t('errors.qualityRequired'));
      return;
    }
    for (const field of ['photoBefore', 'photoAfter']) {
      const file = formData.get(field);
      if (!(file instanceof File) || file.size === 0) {
        failOn(0, t('errors.photosRequired'));
        return;
      }
    }
    // The storefront photo describes the visit, not a stand, so it is not a stand's fault.
    {
      const file = formData.get('photoStore');
      if (!(file instanceof File) || file.size === 0) {
        setClientError(t('errors.photosRequired'));
        return;
      }
    }

    for (const [i, stand] of extraStands.entries()) {
      const standHasParts =
        Object.keys(stand.replaced).length + Object.keys(stand.repaired).length > 0;
      if (!standHasParts && !stand.reason) {
        failOn(i + 1, t('errors.partsOrReason'));
        return;
      }
      if (standHasParts && stand.quality === null) {
        failOn(i + 1, t('errors.qualityRequired'));
        return;
      }
      for (const field of [`extra_${i}_photoBefore`, `extra_${i}_photoAfter`]) {
        const file = formData.get(field);
        if (!(file instanceof File) || file.size === 0) {
          failOn(i + 1, t('errors.photosRequired'));
          return;
        }
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
    formData.set('extraStandCount', String(extraStands.length));
    if (quality !== null) formData.set('qualityScore', String(quality));

    startTransition(() => formAction(formData));
  };

  if (state.success) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <div className="text-4xl">✓</div>
        <h2 className="mt-3 text-lg font-bold text-teal-700">{t('submitted')}</h2>
        <p className="mt-1 text-sm text-brand-600">
          {t('submittedCode', { code: state.success.formCode })}
        </p>
        {state.success.extraFormCodes?.length ? (
          <p className="mt-1 text-xs text-ink-500">
            {state.success.extraFormCodes.join(' · ')}
          </p>
        ) : null}
        {state.success.isReRepair ? (
          <p className="mt-2 text-xs text-amber-700">{tt('reRepairWarning')}</p>
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

      {/* ---------------- the store this visit is about ----------------
          The uid names the STORE, not a cabinet, and every stand below shares it. It
          leads the screen because it is the one thing the technician checks against the
          sticker in front of them before entering anything else. */}
      <Card className="p-4">
        <div className="text-[11px] text-[var(--muted)]">{tc('uid')}</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="dir-ltr text-[26px] font-bold leading-tight tracking-[0.01em]">
            {props.uid}
          </div>
          <span className="shrink-0 rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-900">
            {t('standCount', { n: standCount })}
          </span>
        </div>
        {props.prefill.storeName || props.prefill.storeAddress ? (
          <div className="mt-2 text-[13px] text-ink-500">
            {[props.prefill.storeName, props.prefill.storeAddress].filter(Boolean).join(' — ')}
          </div>
        ) : null}
      </Card>

      {/* ---------------- general ---------------- */}
      <Card>
        <CardHeader title={t('sectionGeneral')} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--muted)]">{t('formCode')}</dt>
            <dd className="text-xs text-ink-400">{t('assignedOnSubmit')}</dd>
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

      {/* ---------------- the stands at this store ----------------
          One panel per stand, switched rather than stacked: these blocks are long, and
          scrolling past a finished stand to reach the next one is where a technician
          loses their place. Hidden panels stay mounted — unmounting would drop their
          already-chosen photos out of the form.

          Everything inside a panel belongs to ONE stand and stays together: parts,
          quality, and crucially its own before/after photos. The photos used to sit in a
          shared card after the other stands, which meant filling stand 1's parts, then
          all of stand 2, then coming back for stand 1's photos — an easy way to attach
          the wrong pair. */}
      <StandTabs
        tabs={standTabs}
        active={activeStand}
        onSelect={setActiveStand}
        onAdd={addStand}
        canAdd={standCount < MAX_STANDS}
      />

      <div className={clsx('space-y-4', activeStand !== 0 && 'hidden')}>

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
                        : 'border-[var(--border)] bg-white text-brand-600 hover:bg-brand-50',
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

        {/* This stand's own before/after shots, captured while it is still in front of
            the technician. */}
        <Card>
          <CardHeader title={t('sectionPhotos')} description={t('standPhotosHelp')} />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <PhotoInput label={t('photoBefore')} name="photoBefore" required />
            <PhotoInput label={t('photoAfter')} name="photoAfter" required />
          </div>
        </Card>
      </div>

      {extraStands.map((stand, i) => (
        <div key={i} className={clsx(activeStand !== i + 1 && 'hidden')}>
          <ExtraStandSection
            index={i}
            uid={props.uid}
            parts={props.parts}
            value={stand}
            onChange={(next) =>
              setExtraStands((prev) => prev.map((s, j) => (j === i ? next : s)))
            }
            onRemove={() => removeStand(i)}
          />
        </div>
      ))}

      {/* ---------------- shared: the store itself ----------------
          The storefront photo and any extras describe the visit, not one stand, so they
          are shared across every stand reported here. */}
      <Card>
        <CardHeader title={t('sectionStorePhoto')} description={t('photosHelp')} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <PhotoInput label={t('photoStore')} name="photoStore" required />
          <div>
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
