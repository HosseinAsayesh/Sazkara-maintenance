'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { JalaliDateInput } from './JalaliDateInput';
import { Alert, Button, Card, CardHeader, Field, Select } from './ui';

/**
 * Evidence pack for one city/day, restricted to re-repairs.
 *
 * Lives on the re-repair page rather than the main evidence page because re-repairs are
 * reviewed as their own question — "what came back, and why" — separately from the day's
 * ordinary fieldwork.
 */
export function ReRepairEvidencePanel({
  cities,
}: {
  cities: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('evidence');
  const tr = useTranslations('reRepairs');
  const tc = useTranslations('common');

  const [cityId, setCityId] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/manager/evidence/re-repairs?cityId=${encodeURIComponent(
          cityId,
        )}&date=${encodeURIComponent(date)}`,
      );
      if (!response.ok) {
        setError(response.status === 404 ? t('noVisits') : tc('error'));
        return;
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : 're-repairs.pdf';

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
      <CardHeader title={t('title')} description={tr('exportHelp')} />
      <div className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label={t('selectDate')} required>
          <JalaliDateInput value={date} onChange={setDate} ariaLabel={t('selectDate')} />
        </Field>

        <Field label={t('selectCity')} required>
          <Select value={cityId} onChange={(e) => setCityId(e.target.value)}>
            <option value="">—</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <Button type="button" disabled={busy || !cityId || !date} onClick={download}>
            {busy ? t('generating') : tc('download')}
          </Button>
        </div>

        {error ? (
          <div className="sm:col-span-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
