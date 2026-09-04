'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import {
  addPhaseAction,
  createProjectAction,
  setActiveProjectAction,
  type ActionState,
} from '@/app/actions/projects';

import { Link } from '@/i18n/navigation';

import { JalaliDateInput } from './JalaliDateInput';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
} from './ui';
import { useState } from 'react';

export interface ProjectRow {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  startDate: string;
  endDate: string | null;
  formCount: number;
  batchCount: number;
  phases: Array<{ id: string; name: string; sortOrder: number }>;
  batches: Array<{
    id: string;
    name: string;
    source: string;
    phaseName: string | null;
    lineCount: number;
    importedAt: string;
    fileUrl: string | null;
  }>;
}

/**
 * Project register.
 *
 * A project is the unit the manager thinks in: it scopes the dashboard, the exports and
 * — most consequentially — what counts as a re-repair. Marking one "current" is what
 * makes it the default everywhere and where stray field-found UIDs get filed.
 */
export function ProjectsManager({
  locale,
  projects,
}: {
  locale: string;
  projects: ProjectRow[];
}) {
  const t = useTranslations('projects');
  const tc = useTranslations('common');
  const ti = useTranslations('imports');
  const tErr = useTranslations('errors');

  const [createState, createAction, creating] = useActionState<ActionState, FormData>(
    createProjectAction,
    {},
  );
  const [activeState, activateAction] = useActionState<ActionState, FormData>(
    setActiveProjectAction,
    {},
  );

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const showError = (state: ActionState) =>
    state.error ? (
      <Alert tone="danger">
        {tErr.has(state.error) ? tErr(state.error) : tc('error')}
      </Alert>
    ) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('title')} description={t('description')} />

        {projects.length === 0 ? (
          <div className="p-4">
            <EmptyState>{t('none')}</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {projects.map((project) => (
              <li key={project.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-brand-900">{project.name}</span>
                      {project.code ? (
                        <span className="text-xs text-[var(--muted)]">{project.code}</span>
                      ) : null}
                      {project.isActive ? (
                        <Badge tone="success">{t('active')}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {project.startDate}
                      {project.endDate ? ` — ${project.endDate}` : ''} ·{' '}
                      {project.formCount} {t('forms')} · {project.batchCount}{' '}
                      {t('batches')}
                    </p>
                  </div>

                  {!project.isActive ? (
                    <form action={activateAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="projectId" value={project.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t('setActive')}
                      </Button>
                    </form>
                  ) : null}
                </div>

                {/* Everything imported into this campaign, including archives of past
                    work, with the uploaded original still downloadable. */}
                {project.batches.length ? (
                  <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2">
                    {project.batches.map((batch) => (
                      <li
                        key={batch.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/manager/imports/${batch.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {batch.name}
                          </Link>
                          <Badge tone={batch.source === 'HISTORICAL' ? 'warning' : 'neutral'}>
                            {ti(`source.${batch.source}`)}
                          </Badge>
                          {batch.phaseName ? (
                            <span className="text-[var(--muted)]">{batch.phaseName}</span>
                          ) : null}
                          <span className="text-[var(--muted)]">
                            {batch.lineCount} · {batch.importedAt}
                          </span>
                        </span>
                        {batch.fileUrl ? (
                          <a
                            href={batch.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-brand-700 underline"
                          >
                            {tc('download')}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">{t('phases')}:</span>
                  {project.phases.map((phase) => (
                    <Badge key={phase.id}>{phase.name}</Badge>
                  ))}
                  <AddPhaseForm locale={locale} projectId={project.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 pb-3">{showError(activeState)}</div>
      </Card>

      <Card>
        <CardHeader title={t('newProject')} />
        <form action={createAction} className="space-y-3 p-4">
          <input type="hidden" name="locale" value={locale} />
          {/* The Jalali pickers keep their value in hidden fields so the server action
              receives plain ISO dates like every other form. */}
          <input type="hidden" name="startDate" value={startDate} />
          <input type="hidden" name="endDate" value={endDate} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('name')} required>
              <Input name="name" required />
            </Field>
            <Field label={t('code')}>
              <Input name="code" placeholder="P-1404-1" />
            </Field>
            <Field label={t('startDate')} required>
              <JalaliDateInput
                value={startDate}
                onChange={setStartDate}
                ariaLabel={t('startDate')}
              />
            </Field>
            <Field label={t('endDate')}>
              <JalaliDateInput
                value={endDate}
                onChange={setEndDate}
                ariaLabel={t('endDate')}
              />
            </Field>
          </div>

          <Field label={t('phaseNames')}>
            <Input name="phaseNames" placeholder="فاز ۱، فاز ۲" />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="makeActive" defaultChecked />
            {t('makeActive')}
          </label>

          {showError(createState)}
          {createState.ok ? <Alert tone="success">{t('created')}</Alert> : null}

          <Button type="submit" disabled={creating}>
            {creating ? tc('saving') : tc('save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function AddPhaseForm({ locale, projectId }: { locale: string; projectId: string }) {
  const t = useTranslations('projects');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addPhaseAction,
    {},
  );

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="projectId" value={projectId} />
      <input
        name="name"
        required
        placeholder={t('phaseName')}
        aria-label={t('phaseName')}
        className="h-7 w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
      />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {t('addPhase')}
      </Button>
      {state.error ? <span className="text-xs text-rose-600">!</span> : null}
    </form>
  );
}
