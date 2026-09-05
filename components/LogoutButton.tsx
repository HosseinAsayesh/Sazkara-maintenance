import { getTranslations } from 'next-intl/server';

import { logoutAction } from '@/app/actions/auth';

export async function LogoutButton({
  locale,
  onDark = false,
}: {
  locale: string;
  onDark?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <form action={logoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className={
          onDark
            ? 'rounded-lg border border-white/20 px-2.5 py-1 text-xs font-medium text-ink-300 hover:border-red-400/40 hover:bg-red-500/10 hover:text-white'
            : 'rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-red-50 hover:text-red-700'
        }
      >
        {t('logout')}
      </button>
    </form>
  );
}
