import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { formatDateForLocale } from '@/lib/dates';
import { currentLicense } from '@/lib/license';

/**
 * The strip under the header. Read-only is shown to everyone, since everyone's saves are
 * refused; "expires soon" only to managers, who are the ones who can act on it.
 */
export async function LicenseBanner({
  locale,
  isManager,
}: {
  locale: string;
  isManager: boolean;
}) {
  const license = await currentLicense();
  const t = await getTranslations({ locale, namespace: 'license' });

  const date = license.expiresAt ? formatDateForLocale(license.expiresAt, locale) : '';

  let tone: string;
  let message: string;
  if (license.readOnly) {
    tone = 'border-red-200 bg-red-50 text-red-900';
    message =
      license.status === 'expired' ? t('banner.expired', { date }) : t('banner.missing');
  } else if (isManager && license.status === 'expiring') {
    tone = 'border-amber-200 bg-amber-50 text-amber-900';
    message = t('banner.expiring', { date, count: license.daysLeft ?? 0 });
  } else {
    return null;
  }

  return (
    <div role="status" className={`border-b ${tone}`}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-7">
        <span>{message}</span>
        {isManager ? (
          <Link href="/manager/settings#license" className="font-semibold underline">
            {t('banner.action')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
