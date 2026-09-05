'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import { addManualUidsAction, type CommitState } from '@/app/actions/imports';

import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from './ui';

/**
 * §5 — Jti sometimes sends a handful of stray uids as plain text rather than in the
 * spreadsheet. These enter through the same pending-confirmation gate as a technician's
 * unknown uid (§6.2) rather than straight into the official record.
 *
 * They also have to land somewhere sensible. A stray uid arrives DURING a campaign, so it
 * belongs either in the order it came against or at least in the current project —
 * filing each one as its own single-row "order" buries the real order list and leaves the
 * uid outside every project filter.
 */
export function ManualUidsForm({
  locale,
  cities,
  projects = [],
  orders = [],
}: {
  locale: string;
  cities: Array<{ id: string; name: string }>;
  projects?: Array<{
    id: string;
    name: string;
    isActive: boolean;
    phases: Array<{ id: string; name: string }>;
  }>;
  /** Existing orders a stray uid can be appended to. */
  orders?: Array<{ id: string; name: string; projectName: string | null }>;
}) {
  const t = useTranslations('imports');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<CommitState, FormData>(
    addManualUidsAction,
    {},
  );

  const [targetBatchId, setTargetBatchId] = useState('');
  const [projectId, setProjectId] = useState(
    projects.find((p) => p.isActive)?.id ?? '',
  );
  const [phaseId, setPhaseId] = useState('');
  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];
  const appending = !!targetBatchId;

  return (
    <Card>
      <CardHeader title={t('manualUid')} description={t('manualUidHelp')} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="locale" value={locale} />

        {/* Append to an existing order, or start a new one inside a project. */}
        <Field label={t('targetOrder')} hint={t('targetOrderHelp')}>
          <Select
            name="targetBatchId"
            value={targetBatchId}
            onChange={(e) => setTargetBatchId(e.target.value)}
          >
            <option value="">{t('targetNewOrder')}</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.projectName ? ` — ${o.projectName}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('batchName')}>
          <Input
            name="name"
            placeholder={t('batchNamePlaceholder')}
            disabled={appending}
          />
        </Field>

        {!appending && projects.length ? (
          <>
            <Field label={tc('project')}>
              <Select
                name="projectId"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setPhaseId('');
                }}
              >
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isActive ? ' ★' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={tc('phase')}>
              <Select
                name="phaseId"
                value={phaseId}
                onChange={(e) => setPhaseId(e.target.value)}
                disabled={!phases.length}
              >
                <option value="">—</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}

        <Field label={tc('city')}>
          <Select name="cityName" defaultValue="">
            <option value="">—</option>
            {cities.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <Field label={tc('uid')} required>
            <Textarea name="uids" placeholder={t('manualUidPlaceholder')} dir="ltr" required />
          </Field>
        </div>

        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? tc('submitting') : tc('save')}
          </Button>
          {state.ok ? (
            <span className="text-sm text-emerald-700">
              {t('committed', { count: state.ok.created })}
            </span>
          ) : null}
        </div>

        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="danger">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : tc('error')}
            </Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
