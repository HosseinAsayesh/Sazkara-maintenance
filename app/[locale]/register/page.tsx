import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { RegisterForm } from '@/components/RegisterForm';
import { getCurrentUser } from '@/lib/auth';

export default async function RegisterPage({ params }: PageProps<'/[locale]/register'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (user) redirect(`/${locale}/${user.role === 'MANAGER' ? 'manager' : 'technician'}`);

  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <AuthShell title={t('registerTitle')} subtitle={t('registerSubtitle')} locale={locale}>
      <RegisterForm locale={locale} />
    </AuthShell>
  );
}
