import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { LoginForm } from '@/components/LoginForm';
import { getCurrentUser } from '@/lib/auth';

export default async function LoginPage({ params, searchParams }: PageProps<'/[locale]/login'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (user) redirect(`/${locale}/${user.role === 'MANAGER' ? 'manager' : 'technician'}`);

  const { next } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <AuthShell title={t('loginTitle')} subtitle={t('loginSubtitle')} locale={locale}>
      <LoginForm locale={locale} next={typeof next === 'string' ? next : ''} />
    </AuthShell>
  );
}
