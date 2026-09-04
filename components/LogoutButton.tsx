import { getTranslations } from 'next-intl/server';

import { logoutAction } from '@/app/actions/auth';

export async function LogoutButton({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <form action={logoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-red-50 hover:text-red-700"
      >
        {t('logout')}
      </button>
    </form>
  );
}
