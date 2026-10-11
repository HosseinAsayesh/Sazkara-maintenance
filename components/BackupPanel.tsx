'use client';

import clsx from 'clsx';
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Alert, Button, Card, CardHeader, Field, Select } from './ui';

const PARTS = ['projects', 'orders', 'uids', 'reRepairs', 'photos'] as const;
type Part = (typeof PARTS)[number];

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'downloading'; received: number; estimate: number; files: number }
  | { kind: 'done'; url: string; filename: string; bytes: number }
  | { kind: 'error' };

/** The file name the server chose (RFC 5987 `filename*` carries the Persian one). */
function filenameFrom(header: string | null): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) return decodeURIComponent(star);
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? 'backup.zip';
}

/**
 * A ring that fills as the backup arrives. Before the first byte the server is still
 * gathering the sheets, so the ring spins instead of claiming progress it cannot know.
 */
function ProgressRing({ fraction, spinning, done }: { fraction: number; spinning: boolean; done: boolean }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const shown = spinning ? 0.25 : Math.min(1, Math.max(0, fraction));
  return (
    <svg
      viewBox="0 0 120 120"
      className={clsx('h-36 w-36 -rotate-90', spinning && 'animate-spin [animation-duration:1.1s]')}
      aria-hidden
    >
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        className={clsx(
          'transition-[stroke-dashoffset] duration-300 ease-out',
          done ? 'stroke-teal-600' : 'stroke-brand-600',
        )}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)}
      />
    </svg>
  );
}

export function BackupPanel({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const t = useTranslations('backup');
  const locale = useLocale();
  const [selected, setSelected] = useState<Set<Part>>(new Set(PARTS));
  const [projectId, setProjectId] = useState('all');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const mb = (bytes: number) =>
    (bytes / (1024 * 1024)).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US', {
      maximumFractionDigits: bytes < 10 * 1024 * 1024 ? 1 : 0,
    });

  const toggle = (part: Part) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });

  const busy = phase.kind === 'preparing' || phase.kind === 'downloading';

  const start = async () => {
    if (phase.kind === 'done') URL.revokeObjectURL(phase.url);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'preparing' });
    try {
      const params = new URLSearchParams({ parts: [...selected].join(','), projectId });
      const res = await fetch(`/api/manager/backup?${params}`, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const estimate = Number(res.headers.get('X-Backup-Estimate')) || 0;
      const files = Number(res.headers.get('X-Backup-Files')) || 0;
      const filename = filenameFrom(res.headers.get('Content-Disposition'));

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      setPhase({ kind: 'downloading', received, estimate, files });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setPhase({ kind: 'downloading', received, estimate, files });
      }

      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/zip' }));
      setPhase({ kind: 'done', url, filename, bytes: received });

      // Hand the file over straight away; the link below stays for a second copy.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      if ((err as Error).name === 'AbortError') setPhase({ kind: 'idle' });
      else setPhase({ kind: 'error' });
    } finally {
      abort.current = null;
    }
  };

  const fraction =
    phase.kind === 'downloading' && phase.estimate > 0
      ? // Never show 100% before the last byte: the estimate is close, not exact.
        Math.min(0.99, phase.received / phase.estimate)
      : phase.kind === 'done'
        ? 1
        : 0;

  return (
    <Card id="backup">
      <CardHeader title={t('title')} description={t('help')} />
      <div className="grid gap-6 p-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-brand-900">{t('include')}</legend>
            {PARTS.map((part) => (
              <label
                key={part}
                className={clsx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm',
                  selected.has(part) ? 'border-brand-400 bg-brand-50' : 'border-[var(--border)] bg-white',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(part)}
                  onChange={() => toggle(part)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{t(`parts.${part}`)}</span>
                  <span className="block text-xs text-[var(--muted)]">{t(`partsHelp.${part}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field label={t('project')}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
              <option value="all">{t('allProjects')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={start} disabled={busy || selected.size === 0}>
              {busy ? t('working') : t('start')}
            </Button>
            {busy ? (
              <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>
                {t('cancel')}
              </Button>
            ) : null}
          </div>

          {phase.kind === 'error' ? <Alert tone="danger">{t('failed')}</Alert> : null}
        </div>

        {/* The ring: spins while the server gathers, fills as the zip arrives. */}
        <div className="flex flex-col items-center justify-center gap-2 md:min-w-56" aria-live="polite">
          <div className="relative">
            <ProgressRing
              fraction={fraction}
              spinning={phase.kind === 'preparing'}
              done={phase.kind === 'done'}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              {phase.kind === 'done' ? (
                <span className="text-3xl text-teal-600">✓</span>
              ) : phase.kind === 'downloading' ? (
                <span className="text-2xl font-bold tabular-nums text-brand-900">
                  {num(Math.round(fraction * 100))}٪
                </span>
              ) : phase.kind === 'preparing' ? null : (
                <span className="text-3xl text-[var(--muted)]">⤓</span>
              )}
            </div>
          </div>
          <div className="min-h-10 text-center text-xs text-[var(--muted)]">
            {phase.kind === 'preparing' ? t('preparing') : null}
            {phase.kind === 'downloading' ? (
              <>
                <div>{t('progress', { done: mb(phase.received), total: mb(phase.estimate) })}</div>
                <div>{t('files', { n: num(phase.files) })}</div>
              </>
            ) : null}
            {phase.kind === 'done' ? (
              <>
                <div className="font-medium text-teal-700">{t('done', { size: mb(phase.bytes) })}</div>
                <a href={phase.url} download={phase.filename} className="text-brand-700 underline">
                  {t('again')}
                </a>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
