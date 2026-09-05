'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { JalaliDateInput } from './JalaliDateInput';
import { Alert, Button, Card, CardHeader, Field, Select } from './ui';

export interface WorkExportProject {
  id: string;
  name: string;
  isActive: boolean;
  phases: Array<{ id: string; name: string }>;
}

/**
 * Download your own work — or, for a crew lead, one crew member's or the whole crew's —
 * for a period and/or a project.
 *
 * The server decides whose records may be read; `technicianId` here only narrows within
 * what the caller is already entitled to see, so a tampered value cannot widen access.
 */
export function WorkExportPanel({
  projects,
  crew,
}: {
  projects: WorkExportProject[];
  /** Offered only to a lead/manager. Empty for a technician exporting their own work. */
  crew?: Array<{ id: string; name: string; technicianCode: string | null }>;
}) {
  const t = useTranslations('workExport');
  const tc = useTranslations('common');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (projectId) params.set('projectId', projectId);
      if (phaseId && phases.some((p) => p.id === phaseId)) params.set('phaseId', phaseId);
      if (technicianId) params.set('technicianId', technicianId);

      const response = await fetch(`/api/work-export?${params.toString()}`);
      if (!response.ok) {
        setError(response.status === 404 ? t('noRows') : tc('error'));
        return;
      }

      // Take the server's filename so the Persian name and Jalali range survive.
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : 'work.xlsx';

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
    <Card>
      <CardHeader title={t('title')} description={t('help')} />
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={tc('from')}>
          <JalaliDateInput value={from} onChange={setFrom} ariaLabel={tc('from')} />
        </Field>
        <Field label={tc('to')}>
          <JalaliDateInput value={to} onChange={setTo} ariaLabel={tc('to')} />
        </Field>

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
                {p.isActive ? ' ★' : ''}
              </option>
            ))}
          </Select>
        </Field>

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

        {crew?.length ? (
          <Field label={t('technician')}>
            <Select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              <option value="">{t('wholeCrew')}</option>
              {crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.technicianCode ? `${c.technicianCode} — ` : ''}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="button" disabled={busy} onClick={download}>
            {busy ? t('generating') : t('download')}
          </Button>
        </div>

        {error ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
