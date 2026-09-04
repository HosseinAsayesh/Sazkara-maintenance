import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { formatDateForLocale } from '@/lib/dates';

import { Badge, Card, CardHeader, EmptyState } from './ui';

interface HistoryForm {
  id: string;
  formCode: string;
  date: Date;
  outcome: 'REPAIRED' | 'NOT_REPAIRED';
  isReRepair: boolean;
  notRepairedReason: string | null;
  qualityScore: number | null;
  notes: string | null;
  technician: { name: string; technicianCode: string | null };
  city: { name: string } | null;
  parts: Array<{ action: string; quantity: number; part: { nameFa: string; nameEn: string } }>;
}

/**
 * §6.7 — a stand's permanent history, shown to the technician before they fill the form
 * and to the manager in uid search. Compact by design: what was done, when, by whom.
 */
export async function StandHistory({
  locale,
  history,
  canEdit = false,
}: {
  locale: string;
  history: HistoryForm[];
  /** Managers get a link into the report editor; technicians see a plain code. */
  canEdit?: boolean;
}) {
  const [t, tr, ta, to] = await Promise.all([
    getTranslations({ locale, namespace: 'technician' }),
    getTranslations({ locale, namespace: 'reasons' }),
    getTranslations({ locale, namespace: 'action' }),
    getTranslations({ locale, namespace: 'outcome' }),
  ]);

  return (
    <Card>
      <CardHeader title={t('historyTitle')} />
      <div className="p-3">
        {history.length === 0 ? (
          <EmptyState>{t('noHistory')}</EmptyState>
        ) : (
          <ol className="space-y-3">
            {history.map((form) => {
              const replaced = form.parts.filter((p) => p.action === 'REPLACED');
              const repaired = form.parts.filter((p) => p.action === 'REPAIRED');
              const nameOf = (p: { nameFa: string; nameEn: string }) =>
                locale === 'fa' ? p.nameFa : p.nameEn;
              // Keep digits in the same script as the surrounding text.
              const qty = (n: number) =>
                n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');

              return (
                <li
                  key={form.id}
                  className="rounded-lg border border-[var(--border)] bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={form.outcome === 'REPAIRED' ? 'success' : 'danger'}>
                      {to(form.outcome)}
                    </Badge>
                    {form.isReRepair ? <Badge tone="warning">↻</Badge> : null}
                    <span className="text-sm font-medium text-slate-800">
                      {formatDateForLocale(form.date, locale)}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {form.technician.name}
                      {form.technician.technicianCode
                        ? ` (${form.technician.technicianCode})`
                        : ''}
                      {form.city ? ` · ${form.city.name}` : ''}
                    </span>
                    {/* Managers can open the report to correct or delete it; the
                        technician view keeps it as plain text. */}
                    <span className="ms-auto dir-ltr text-xs text-[var(--muted)]">
                      {canEdit ? (
                        <Link
                          href={`/manager/form/${form.id}`}
                          className="text-brand-700 hover:underline"
                        >
                          {form.formCode}
                        </Link>
                      ) : (
                        form.formCode
                      )}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {replaced.length ? (
                      <div>
                        <span className="font-semibold">{ta('REPLACED')}: </span>
                        {replaced.map((p) => `${nameOf(p.part)} ×${qty(p.quantity)}`).join('، ')}
                      </div>
                    ) : null}
                    {repaired.length ? (
                      <div>
                        <span className="font-semibold">{ta('REPAIRED')}: </span>
                        {repaired.map((p) => `${nameOf(p.part)} ×${qty(p.quantity)}`).join('، ')}
                      </div>
                    ) : null}
                    {form.outcome === 'NOT_REPAIRED' && form.notRepairedReason ? (
                      <div className="text-amber-800">{tr(form.notRepairedReason)}</div>
                    ) : null}
                    {form.notes ? (
                      <div className="text-[var(--muted)]">{form.notes}</div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
