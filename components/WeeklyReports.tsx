'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import type { ActionState } from '@/app/actions/manager';
import {
  approveWeeklyReportAction,
  submitWeeklyReportAction,
  withdrawWeeklyReportAction,
} from '@/app/actions/weekly-reports';

import { JalaliDateInput } from './JalaliDateInput';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from './ui';

/** Manager: send a period's report to Jti — built by the app, or a file they upload. */
export function WeeklyReportForm({
  locale,
  projects,
  defaultProjectId,
}: {
  locale: string;
  projects: Array<{ id: string; name: string }>;
  defaultProjectId: string;
}) {
  const t = useTranslations('weekly');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    submitWeeklyReportAction,
    {},
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<'GENERATE' | 'UPLOAD'>('GENERATE');

  return (
    <Card>
      <CardHeader title={t('sendTitle')} description={t('sendHelp')} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        <Field label={tc('from')} required>
          <JalaliDateInput value={from} onChange={setFrom} ariaLabel={tc('from')} />
        </Field>
        <Field label={tc('to')} required>
          <JalaliDateInput value={to} onChange={setTo} ariaLabel={tc('to')} />
        </Field>
        <Field label={tc('project')}>
          <Select name="projectId" defaultValue={defaultProjectId}>
            <option value="">{tc('allProjects')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('fileSource')}>
          <div className="flex flex-wrap gap-2">
            {(['GENERATE', 'UPLOAD'] as const).map((m) => (
              <label
                key={m}
                className={
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ' +
                  (mode === m ? 'border-brand-400 bg-brand-50' : 'border-[var(--border)] bg-white')
                }
              >
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {m === 'GENERATE' ? t('modeGenerate') : t('modeUpload')}
              </label>
            ))}
          </div>
        </Field>
        {mode === 'UPLOAD' ? (
          <div className="sm:col-span-2">
            <Field label={t('uploadFile')} hint={t('uploadHint')} required>
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
              />
            </Field>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field label={t('note')} hint={t('noteHint')}>
            <Textarea name="note" rows={2} />
          </Field>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending || !from || !to}>
            {pending ? t('sending') : t('send')}
          </Button>
        </div>
        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="danger">{t(`errors.${state.error}`)}</Alert>
          </div>
        ) : null}
        {state.ok ? (
          <div className="sm:col-span-2">
            <Alert tone="success">{t('sent')}</Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

/** Manager: take back a report Jti has not approved yet. */
export function WithdrawWeeklyReport({ locale, id }: { locale: string; id: string }) {
  const t = useTranslations('weekly');
  const [, action, pending] = useActionState<ActionState, FormData>(
    withdrawWeeklyReportAction,
    {},
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t('withdrawConfirm'))) e.preventDefault();
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t('withdraw')}
      </Button>
    </form>
  );
}

/**
 * Jti: open the report, then approve it with name and signature. The approve button
 * stays locked until the file has been opened — here or on an earlier visit.
 */
export function ApproveWeeklyReport({
  locale,
  id,
  viewed: viewedBefore,
  canSign,
}: {
  locale: string;
  id: string;
  viewed: boolean;
  /** False for a manager looking through the Jti view: they may look, not sign. */
  canSign: boolean;
}) {
  const t = useTranslations('weekly');
  const [state, action] = useActionState<ActionState, FormData>(approveWeeklyReportAction, {});
  const [pending, startTransition] = useTransition();
  const [viewed, setViewed] = useState(viewedBefore);
  const [name, setName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const sig = useRef<SignaturePadHandle | null>(null);

  const markViewed = () => setViewed(true);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const blob = await sig.current?.toBlob();
    if (!blob) return;
    const fd = new FormData();
    fd.set('locale', locale);
    fd.set('id', id);
    fd.set('approverName', name);
    fd.set('signature', blob, 'signature.png');
    startTransition(() => action(fd));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/weekly-reports/${id}?as=xlsx`}
          onClick={markViewed}
          className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-brand-900 hover:bg-brand-50"
        >
          {t('downloadExcel')}
        </a>
        <a
          href={`/api/weekly-reports/${id}?as=pdf`}
          onClick={markViewed}
          className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-brand-900 hover:bg-brand-50"
        >
          {t('downloadPdf')}
        </a>
      </div>

      {canSign ? (
        viewed ? (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-[var(--border)] p-3">
            <p className="text-xs text-[var(--muted)]">{t('approveHelp')}</p>
            <Field label={t('approverName')} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <SignaturePad ref={sig} label={t('signature')} onChange={setHasInk} />
            <Button type="submit" variant="success" disabled={pending || name.trim().length < 2 || !hasInk}>
              {pending ? t('approving') : t('approve')}
            </Button>
            {state.error ? <Alert tone="danger">{t(`errors.${state.error}`)}</Alert> : null}
          </form>
        ) : (
          <Alert tone="warning">{t('openFirst')}</Alert>
        )
      ) : null}
    </div>
  );
}
