import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { QueryThread } from '@/components/client/QueryThread';
import { RaiseQueryForm } from '@/components/client/RaiseQueryForm';
import { Alert, Badge, Card, CardHeader } from '@/components/ui';
import { requireClientViewer } from '@/lib/auth';
import { getClientFormDetail, getClientScope } from '@/lib/client-view';
import { formatDateForLocale } from '@/lib/dates';

/**
 * The page a query hangs off. Everything here is already redacted by client-view: no
 * technician, no wage, no photographs.
 */
export default async function ClientFormPage({
  params,
}: PageProps<'/[locale]/client/form/[formId]'>) {
  const { locale, formId } = await params;
  setRequestLocale(locale);
  const user = await requireClientViewer(locale);

  const t = await getTranslations({ locale, namespace: 'client' });
  const tr = await getTranslations({ locale, namespace: 'reasons' });
  const tf = await getTranslations({ locale, namespace: 'form' });

  const scope = await getClientScope();
  if (!scope) return <Alert tone="info">{t('noActiveProject')}</Alert>;

  const form = await getClientFormDetail(scope.projectId, formId);
  if (!form) notFound();

  const num = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const partName = (p: (typeof form.parts)[number]) =>
    locale === 'fa' ? p.nameFa : p.nameEn;
  const replaced = form.parts.filter((p) => p.action === 'REPLACED');
  const repaired = form.parts.filter((p) => p.action === 'REPAIRED');
  const viewerSide = user.role === 'CLIENT_SUPERVISOR' ? 'CLIENT' : 'TEAM';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-brand-900 dir-ltr">{form.formCode}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          <span className="dir-ltr">{form.uid}</span> · {form.storeName} · {form.cityName}{' '}
          · {formatDateForLocale(form.date, locale)}
        </p>
      </div>

      <Card>
        <CardHeader title={t('visitTitle')} />
        <dl className="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[var(--muted)]">{t('outcome')}</dt>
            <dd className="mt-0.5">
              {form.outcome === 'REPAIRED' ? (
                <Badge tone="success">{t('outcomeRepaired')}</Badge>
              ) : (
                <span className="flex flex-col gap-1">
                  <Badge tone="danger">{t('outcomeNotRepaired')}</Badge>
                  {form.notRepairedReason ? (
                    <span className="text-sm">{tr(form.notRepairedReason)}</span>
                  ) : null}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">{t('standIndexLabel')}</dt>
            <dd className="mt-0.5 font-medium">{num(form.standIndex)}</dd>
          </div>
          {form.qualityScore !== null ? (
            <div>
              <dt className="text-xs text-[var(--muted)]">{tf('qualityScore')}</dt>
              <dd className="mt-0.5 font-medium">{num(form.qualityScore)}</dd>
            </div>
          ) : null}
          {form.storeAddress ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted)]">{tf('storeAddress')}</dt>
              <dd className="mt-0.5 text-sm">{form.storeAddress}</dd>
            </div>
          ) : null}
          {replaced.length ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted)]">{tf('replacedParts')}</dt>
              <dd className="mt-0.5 text-sm">
                {replaced.map((p) => `${partName(p)} ×${num(p.quantity)}`).join('، ')}
              </dd>
            </div>
          ) : null}
          {repaired.length ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted)]">{tf('repairedParts')}</dt>
              <dd className="mt-0.5 text-sm">
                {repaired.map((p) => `${partName(p)} ×${num(p.quantity)}`).join('، ')}
              </dd>
            </div>
          ) : null}
          {form.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted)]">{tf('notes')}</dt>
              <dd className="mt-0.5 text-sm">{form.notes}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {form.queries.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-brand-900">{t('queriesOnThisForm')}</h2>
          {form.queries.map((q) => (
            <QueryThread
              key={q.id}
              locale={locale}
              queryId={q.id}
              status={q.status}
              messages={q.messages}
              viewerSide={viewerSide}
            />
          ))}
        </section>
      ) : null}

      {/* Only Jti opens threads. A manager reading this page replies inside an existing
          one; they have the rest of the system to raise anything else. */}
      {user.role === 'CLIENT_SUPERVISOR' ? (
        <RaiseQueryForm locale={locale} formId={form.id} />
      ) : null}
    </div>
  );
}
