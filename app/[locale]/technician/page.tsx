import { getTranslations, setRequestLocale } from 'next-intl/server';

import { UidEntryForm } from '@/components/UidEntryForm';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { requireTechnician } from '@/lib/auth';
import { formatDateForLocale } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export default async function TechnicianHome({ params }: PageProps<'/[locale]/technician'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireTechnician(locale);
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'technician' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const recent = await prisma.repairForm.findMany({
    where: { technicianId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { stand: { select: { uid: true } }, city: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-md space-y-5">
      <Card className="p-5">
        <h1 className="text-lg font-bold text-brand-900">{t('enterUidTitle')}</h1>
        <p className="mb-4 mt-1 text-xs text-[var(--muted)]">{t('enterUidHelp')}</p>
        <UidEntryForm />
      </Card>

      <Card>
        <CardHeader title={tc('search')} description={t('historyTitle')} />
        <div className="p-3">
          {recent.length === 0 ? (
            <EmptyState>{tc('noResults')}</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {recent.map((form) => (
                <li key={form.id}>
                  <Link
                    href={`/technician/stand/${encodeURIComponent(form.stand.uid)}`}
                    className="flex items-center justify-between gap-3 px-1 py-2.5 hover:bg-brand-50"
                  >
                    <div className="min-w-0">
                      <div className="dir-ltr text-sm font-semibold text-slate-800">
                        {form.stand.uid}
                      </div>
                      <div className="truncate text-xs text-[var(--muted)]">
                        {form.storeName || form.city?.name || '—'} ·{' '}
                        {formatDateForLocale(form.date, locale)}
                      </div>
                    </div>
                    <Badge tone={form.outcome === 'REPAIRED' ? 'success' : 'danger'}>
                      {form.outcome === 'REPAIRED' ? '✓' : '✕'}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
