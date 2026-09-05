import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ServiceWorker } from '@/components/ServiceWorker';
import { directionOf, routing } from '@/i18n/routing';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * `themeColor` is the graphite of the app bar, so the phone's status bar continues the
 * header instead of cutting a white strip above it once installed.
 */
export const viewport: Viewport = {
  themeColor: '#232426',
  width: 'device-width',
  initialScale: 1,
  // Technicians photograph stands and read part labels on a phone; pinching to zoom is
  // a real need here, so the usual "maximum-scale=1" lock stays off.
  viewportFit: 'cover',
};

export async function generateMetadata({
  params,
}: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return {
    title: t('name'),
    description: t('tagline'),
    // The root layout lives under [locale], so the manifest link is not injected for us.
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      title: t('shortName'),
      statusBarStyle: 'black-translucent',
    },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
