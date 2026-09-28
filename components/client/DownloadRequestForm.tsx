'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  requestDownloadAction,
  type DownloadActionState,
} from '@/app/actions/client-downloads';

import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../ui';

/**
 * Jti asks the manager for a file.
 *
 * The reason box is required and is the point of the whole screen. A request without one
 * leaves the manager choosing between rubber-stamping and refusing on instinct; a
 * sentence of context turns it into a decision they can actually make — and, when the
 * answer is no, one they can explain.
 */
export function DownloadRequestForm({
  locale,
  cities,
}: {
  locale: string;
  cities: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('client');
  const tc = useTranslations('common');
  const [state, action, pending] = useActionState<DownloadActionState, FormData>(
    requestDownloadAction,
    {},
  );
  const [kind, setKind] = useState('JTI_EXPORT_MAIN');
  const needsDay = kind === 'EVIDENCE_PDF';

  return (
    <Card>
      <CardHeader title={t('requestTitle')} description={t('requestHelp')} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="locale" value={locale} />

        <Field label={t('requestKind')} required>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="JTI_EXPORT_MAIN">{t('kindMain')}</option>
            <option value="JTI_EXPORT_REREPAIRS">{t('kindReRepairs')}</option>
            <option value="PARTS_USAGE_REPORT">{t('kindParts')}</option>
            <option value="EVIDENCE_PDF">{t('kindEvidence')}</option>
          </Select>
        </Field>

        {/* Evidence is generated per city per day, so those two are not optional there. */}
        {needsDay ? (
          <>
            <Field label={t('requestCity')} required>
              <Select name="cityId">
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('requestDay')} required>
              <Input type="date" name="date" />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('requestFrom')} hint={t('requestRangeHint')}>
              <Input type="date" name="from" />
            </Field>
            <Field label={t('requestTo')}>
              <Input type="date" name="to" />
            </Field>
          </>
        )}

        <div className="sm:col-span-2">
          <Field label={t('requestReason')} required hint={t('requestReasonHint')}>
            <Textarea name="reason" rows={2} />
          </Field>
        </div>

        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="danger">{t(`requestError.${state.error}`)}</Alert>
          </div>
        ) : null}
        {state.ok ? (
          <div className="sm:col-span-2">
            <Alert tone="success">{t('requestSent')}</Alert>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? tc('saving') : t('requestSubmit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
