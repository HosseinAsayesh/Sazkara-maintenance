import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/AuthShell';
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm';

export default async function ForgotPasswordPage({
  params,
}: PageProps<'/[locale]/forgot-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <AuthShell title={t('forgotTitle')} subtitle={t('forgotSubtitle')} locale={locale}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
