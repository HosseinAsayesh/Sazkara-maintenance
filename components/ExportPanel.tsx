'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, Button, Card, CardHeader, Field, Input, Select } from './ui';

/**
 * §7/§8 — date-range exports. Both downloads are plain GETs against a route handler, so
 * the browser streams the file straight to disk instead of buffering it through React.
 */
export function ExportPanel({
  cities,
}: {
  cities: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('exports');
  const tc = useTranslations('common');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<'combined' | 'perCity' | 'single'>('combined');
  const [cityId, setCityId] = useState('');
  const [includeReRepairs, setIncludeReRepairs] = useState(true);
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
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="dir-ltr"
            />
          </Field>
          <Field label={tc('to')}>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="dir-ltr"
            />
          </Field>
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

          <div className="sm:col-span-2 lg:col-span-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeReRepairs}
                onChange={(e) => setIncludeReRepairs(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t('includeReRepairs')}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {t('includeReRepairsHelp')}
                </span>
              </span>
            </label>
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              type="button"
              disabled={busy || (scope === 'single' && !cityId)}
              onClick={() =>
                download(
                  `/api/manager/exports/jti?${query({
                    scope: scope === 'single' ? 'combined' : scope,
                    cityId: scope === 'single' ? cityId : '',
                    includeReRepairs: includeReRepairs ? 'true' : 'false',
                  })}`,
                )
              }
            >
              {busy ? t('generating') : t('downloadExcel')}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('partsTitle')} description={t('partsHelp')} />
        <div className="p-4">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => download(`/api/manager/exports/parts?${query()}`)}
          >
            {busy ? t('generating') : t('downloadParts')}
          </Button>
        </div>
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
