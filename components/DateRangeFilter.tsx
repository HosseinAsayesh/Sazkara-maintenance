'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { JalaliDateInput } from './JalaliDateInput';
import { Button, Card, Select } from './ui';

export interface ProjectFilterOption {
  id: string;
  name: string;
  isActive: boolean;
  phases: Array<{ id: string; name: string }>;
}

/**
 * Date range + city + project/phase filter, kept in the URL so a filtered view is
 * shareable and survives a refresh.
 *
 * Dates are picked on a real Shamsi calendar (see JalaliDateInput) but travel as ISO
 * Gregorian in the query string, which is what every server-side filter already speaks.
 *
 * The project filter matters because the manager's attention moves wholesale to each new
 * campaign: once a project is running, almost every question they ask is scoped to it.
 */
export function DateRangeFilter({
  from,
  to,
  cities,
  cityId,
  projects,
  projectId,
  phaseId,
  extra,
}: {
  from?: string;
  to?: string;
  cities?: Array<{ id: string; name: string }>;
  cityId?: string;
  projects?: ProjectFilterOption[];
  projectId?: string;
  phaseId?: string;
  extra?: React.ReactNode;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [localFrom, setLocalFrom] = useState(from ?? '');
  const [localTo, setLocalTo] = useState(to ?? '');
  const [localCity, setLocalCity] = useState(cityId ?? '');
  const [localProject, setLocalProject] = useState(projectId ?? '');
  const [localPhase, setLocalPhase] = useState(phaseId ?? '');

  const phases = projects?.find((p) => p.id === localProject)?.phases ?? [];

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of [
      ['from', localFrom],
      ['to', localTo],
      ['cityId', localCity],
      ['projectId', localProject],
      // A phase from a different project would silently filter everything out.
      ['phaseId', phases.some((p) => p.id === localPhase) ? localPhase : ''],
    ]) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <Card className="p-3">
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        {projects?.length ? (
          <label className="min-w-[10rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-500">
              {t('project')}
            </span>
            <Select
              value={localProject}
              onChange={(e) => {
                setLocalProject(e.target.value);
                setLocalPhase('');
              }}
            >
              <option value="">{t('allProjects')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isActive ? ` ★` : ''}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {phases.length ? (
          <label className="min-w-[8rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-500">
              {t('phase')}
            </span>
            <Select value={localPhase} onChange={(e) => setLocalPhase(e.target.value)}>
              <option value="">{t('allPhases')}</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-500">{t('from')}</span>
          <JalaliDateInput
            value={localFrom}
            onChange={setLocalFrom}
            ariaLabel={t('from')}
          />
        </label>

        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-500">{t('to')}</span>
          <JalaliDateInput value={localTo} onChange={setLocalTo} ariaLabel={t('to')} />
        </label>

        {cities ? (
          <label className="min-w-[9rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-500">{t('city')}</span>
            <Select value={localCity} onChange={(e) => setLocalCity(e.target.value)}>
              <option value="">{t('all')}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <Button type="submit" variant="secondary">
          {t('applyFilter')}
        </Button>
        {extra}
      </form>
    </Card>
  );
}
