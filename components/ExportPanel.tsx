'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { JalaliDateInput } from './JalaliDateInput';
import { Alert, Button, Card, CardHeader, Field, Select } from './ui';

export type ExportContentScope = 'MAIN' | 'RE_REPAIR' | 'ALL';

export interface ExportProjectOption {
  id: string;
  name: string;
  isActive: boolean;
  phases: Array<{ id: string; name: string }>;
}

/**
 * §7/§8 — date-range exports. Both downloads are plain GETs against a route handler, so
 * the browser streams the file straight to disk instead of buffering it through React.
 */
export function ExportPanel({
  cities,
  projects = [],
  fixedScope,
  showPartsReport = true,
}: {
  cities: Array<{ id: string; name: string }>;
  projects?: ExportProjectOption[];
  /** Locks the panel to one half of the split — used by the re-repair page. */
  fixedScope?: ExportContentScope;
  showPartsReport?: boolean;
}) {
  const t = useTranslations('exports');
  const tc = useTranslations('common');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<'combined' | 'perCity' | 'single'>('combined');
  const [cityId, setCityId] = useState('');
  const [contentScope, setContentScope] = useState<ExportContentScope>(
    fixedScope ?? 'MAIN',
  );
  const [projectId, setProjectId] = useState(
    projects.find((p) => p.isActive)?.id ?? '',
  );
  const [phaseId, setPhaseId] = useState('');
  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
    return params.toString();
  };

  const download = async (url: string) => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        setError(response.status === 404 ? t('noRows') : tc('error'));
        return;
      }
      // Read the server's Content-Disposition filename rather than inventing one, so the
      // Persian city name and Jalali range in it survive intact.
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : 'export';

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError(tc('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('jtiTitle')} description={t('jtiHelp')} />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={tc('from')}>
            <JalaliDateInput value={from} onChange={setFrom} ariaLabel={tc('from')} />
          </Field>
          <Field label={tc('to')}>
            <JalaliDateInput value={to} onChange={setTo} ariaLabel={tc('to')} />
          </Field>

          {projects.length ? (
            <Field label={tc('project')}>
              <Select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setPhaseId('');
                }}
              >
                <option value="">{tc('allProjects')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {phases.length ? (
            <Field label={tc('phase')}>
              <Select value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
                <option value="">{tc('allPhases')}</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t('scope')}>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="combined">{t('scopeCombined')}</option>
              <option value="perCity">{t('scopePerCity')}</option>
              <option value="single">{t('scopeSingleCity')}</option>
            </Select>
          </Field>
          {scope === 'single' ? (
            <Field label={t('selectCity')}>
              <Select value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {!fixedScope ? (
            <div className="sm:col-span-2 lg:col-span-2">
              <Field label={t('contentScope')} hint={t('contentScopeHelp')}>
                <Select
                  value={contentScope}
                  onChange={(e) =>
                    setContentScope(e.target.value as ExportContentScope)
                  }
                >
                  <option value="MAIN">{t('scopeMain')}</option>
                  <option value="RE_REPAIR">{t('scopeReRepair')}</option>
                  <option value="ALL">{t('scopeAll')}</option>
                </Select>
              </Field>
            </div>
          ) : null}

          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              type="button"
              disabled={busy || (scope === 'single' && !cityId)}
              onClick={() =>
                download(
                  `/api/manager/exports/jti?${query({
                    layout: scope === 'single' ? 'combined' : scope,
                    cityId: scope === 'single' ? cityId : '',
                    scope: contentScope,
                    projectId,
                    phaseId,
                  })}`,
                )
              }
            >
              {busy ? t('generating') : t('downloadExcel')}
            </Button>
          </div>
        </div>
      </Card>

      {showPartsReport ? (
        <Card>
          <CardHeader title={t('partsTitle')} description={t('partsHelp')} />
          <div className="p-4">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                download(
                  `/api/manager/exports/parts?${query({ projectId, phaseId })}`,
                )
              }
            >
              {busy ? t('generating') : t('downloadParts')}
            </Button>
          </div>
        </Card>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
