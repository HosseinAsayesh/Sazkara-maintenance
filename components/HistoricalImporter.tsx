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
  const [format, setFormat] = useState<'AUTO' | 'LEGACY' | 'CURRENT'>('AUTO');
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
        <h2 className="mt-2 text-lg font-bold text-emerald-700">
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

          {/* Both formats stay available for good: a paper report filed mid-project is
              transcribed into whichever spreadsheet the office has to hand. Detection is
              only a default — real archives carry hand-edited headers, so stating the
              format outright has to be possible. */}
          <div className="sm:col-span-2">
            <Field label={t('formatLabel')} hint={t('formatHelp')}>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['AUTO', 'LEGACY', 'CURRENT'] as const).map((option) => (
                  <label
                    key={option}
                    className={
                      'flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ' +
                      (format === option
                        ? 'border-brand-400 bg-brand-50'
                        : 'border-[var(--border)] bg-white')
                    }
                  >
                    <input
                      type="radio"
                      name="format"
                      value={option}
                      checked={format === option}
                      onChange={() => setFormat(option)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium">
                        {t(`format.${option}.title`)}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">
                        {t(`format.${option}.help`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={previewing}>
              {previewing ? tc('loading') : t('dryRun')}
            </Button>
          </div>
          {previewState.error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">
                {ti.has(`errors.${previewState.error}`)
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
              // Commit must read the file exactly as the preview did.
              fd.set('format', preview.format);
              fd.set('phaseId', phases.some((p) => p.id === phaseId) ? phaseId : '');
              commitAction(fd);
            }}
            className="space-y-4 p-4"
          >
            <Alert tone="info">
              {t('willCreate', {
                forms: preview.rows,
                stands: preview.newStands,
                stores: preview.newStores,
              })}
            </Alert>

            {/* Which sheet generation was read. The legacy layout has 28 part columns
                and two of today's parts simply did not exist in it. */}
            <div className="flex flex-wrap gap-2">
              <Badge tone={preview.layout === 'LEGACY' ? 'warning' : 'info'}>
                {preview.layout === 'LEGACY' ? t('layoutLegacy') : t('layoutCurrent')}
              </Badge>
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
