'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  commitHistoricalAction,
  previewHistoricalAction,
  type HistoricalState,
} from '@/app/actions/historical';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Select,
  Input,
  Table,
  TableWrap,
  Td,
  Th,
} from './ui';

/** §7 — bring pre-system Jti exports into the stats. */
export interface HistoricalProjectOption {
  id: string;
  name: string;
  isActive: boolean;
  phases: Array<{ id: string; name: string }>;
}

export function HistoricalImporter({
  locale,
  projects = [],
}: {
  locale: string;
  projects?: HistoricalProjectOption[];
}) {
  const t = useTranslations('historical');
  const ti = useTranslations('imports');
  const tc = useTranslations('common');

  const [previewState, previewAction, previewing] = useActionState<HistoricalState, FormData>(
    previewHistoricalAction,
    {},
  );
  const [commitState, commitAction, committing] = useActionState<HistoricalState, FormData>(
    commitHistoricalAction,
    {},
  );
  const [name, setName] = useState('');
  // An archive filed under no project is invisible to every project filter, so the
  // manager picks the campaign it belonged to at import time.
  const [projectId, setProjectId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];

  const preview = previewState.preview;

  if (commitState.imported) {
    return (
      <Card className="p-6 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="mt-2 text-lg font-bold text-teal-700">
          {t('imported', { count: commitState.imported.count })}
        </h2>
        {commitState.imported.skipped > 0 ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {ti('excluded')}: {commitState.imported.skipped}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('help')} description={t('expectedFormat')} />
        <form action={previewAction} className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label={ti('batchName')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} name="name" />
          </Field>
          <Field label={tc('upload')} required>
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls"
              required
              className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
            />
          </Field>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={previewing}>
              {previewing ? tc('loading') : t('dryRun')}
            </Button>
          </div>
          {previewState.error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">
                {t.has(`errors.${previewState.error}`)
                  ? t(`errors.${previewState.error}`)
                  : ti.has(`errors.${previewState.error}`)
                    ? ti(`errors.${previewState.error}`)
                    : tc('error')}
              </Alert>
            </div>
          ) : null}
        </form>
      </Card>

      {preview ? (
        <Card>
          <CardHeader title={t('dryRun')} />
          <form
            action={(fd) => {
              fd.set('fileRef', preview.fileRef);
              fd.set('name', name || 'Historical import');
              fd.set('locale', locale);
              fd.set('projectId', projectId);
              fd.set('phaseId', phases.some((p) => p.id === phaseId) ? phaseId : '');
              commitAction(fd);
            }}
            className="space-y-4 p-4"
          >
            <Alert tone="info">
              {t('willCreate', {
                forms: preview.forms,
                uids: preview.distinctUids,
                newUids: preview.newUids,
              })}
              {preview.repeatedUids > 0 ? (
                <span className="mt-1 block text-xs">
                  {t('repeatedUids', { count: preview.repeatedUids })}
                </span>
              ) : null}
            </Alert>

            {/* Quantities are read by column position, so a sheet whose part row differs
                from the expected one files parts against the wrong catalogue entries —
                and a number in the wrong column is still a valid number, so nothing
                would fail. Surfaced here, before anything is written. */}
            {preview.columnWarnings.length ? (
              <Alert tone="warning" title={t('columnMismatch')}>
                <span className="block text-xs">{t('columnMismatchHelp')}</span>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {preview.columnWarnings.map((w) => (
                    <li key={w.column}>
                      <span className="font-medium dir-ltr">#{w.column}</span>{' '}
                      — {t('columnExpected')}: «{w.expected || '—'}» · {t('columnFound')}:
                      «{w.found}»
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            {/* The counts the dashboard will show, checked BEFORE anything is written —
                in stands, so a «Dubble» row counts as two. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="text-xs text-[var(--muted)]">{t('previewRows')}</div>
                <div className="text-xl font-bold tabular-nums">{preview.rows}</div>
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                <div className="text-xs text-teal-900">{t('previewRepaired')}</div>
                <div className="text-xl font-bold tabular-nums text-teal-700">{preview.repaired}</div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="text-xs text-red-900">{t('previewNotRepaired')}</div>
                <div className="text-xl font-bold tabular-nums text-red-700">{preview.notRepaired}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="text-xs text-[var(--muted)]">{t('previewExtraStands')}</div>
                <div className="text-xl font-bold tabular-nums">{preview.extraStands}</div>
              </div>
            </div>
            {preview.reasonBreakdown.length ? (
              <ul className="space-y-0.5 text-xs text-[var(--muted)]">
                {preview.reasonBreakdown.map((r) => (
                  <li key={r.label}>
                    {r.label}: <span className="font-medium tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {preview.skipped > 0 ? (
                <Badge tone="warning">
                  {ti('invalidRows', { count: preview.skipped })}
                </Badge>
              ) : null}
              {preview.firstDate ? (
                <Badge tone="neutral">
                  {new Date(preview.firstDate).toLocaleDateString(
                    locale === 'fa' ? 'fa-IR' : 'en-GB',
                  )}
                  {' — '}
                  {preview.lastDate
                    ? new Date(preview.lastDate).toLocaleDateString(
                        locale === 'fa' ? 'fa-IR' : 'en-GB',
                      )
                    : ''}
                </Badge>
              ) : null}
            </div>

            {projects.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tc('project')}>
                  <Select
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
                      </option>
                    ))}
                  </Select>
                </Field>
                {phases.length ? (
                  <Field label={tc('phase')}>
                    <Select value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
                      <option value="">—</option>
                      {phases.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            ) : null}

            <TableWrap>
              <Table className="min-w-0">
                <thead>
                  <tr>
                    <Th>{tc('uid')}</Th>
                    <Th>{tc('date')}</Th>
                    <Th>{tc('city')}</Th>
                    <Th>{tc('quantity')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, i) => (
                    <tr key={`${row.uid}-${i}`}>
                      <Td className="dir-ltr">{row.uid}</Td>
                      <Td>
                        {new Date(row.date).toLocaleDateString(
                          locale === 'fa' ? 'fa-IR' : 'en-GB',
                        )}
                      </Td>
                      <Td>{row.city}</Td>
                      <Td className="tabular-nums">{row.parts}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            <Button type="submit" size="lg" disabled={committing}>
              {committing ? tc('submitting') : t('importNow')}
            </Button>

            {commitState.error ? <Alert tone="danger">{tc('error')}</Alert> : null}
          </form>
        </Card>
      ) : null}
    </div>
  );
}
