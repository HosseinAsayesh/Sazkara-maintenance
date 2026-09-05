import type { MetadataRoute } from 'next';

import fa from '@/messages/fa.json';
import { routing } from '@/i18n/routing';

/**
 * The installed-app identity.
 *
 * A manifest is a single static document while the app is bilingual, so it speaks the
 * default locale: that is what the overwhelming majority of installs will be, and the
 * home-screen label cannot follow a language the user picks later anyway. The strings
 * come from the message catalogue rather than being retyped, so the installed name and
 * the in-app name cannot drift apart.
 *
 * `start_url` carries the locale prefix because `/` only redirects there, and a redirect
 * on every cold launch is a visible delay on a phone.
 */
export default function manifest(): MetadataRoute.Manifest {
  const start = `/${routing.defaultLocale}`;

  return {
    id: start,
    name: fa.app.name,
    short_name: fa.app.shortName,
    description: fa.app.tagline,
    lang: routing.defaultLocale,
    dir: 'rtl',
    start_url: start,
    scope: '/',
    display: 'standalone',
    background_color: '#f5f6f6',
    theme_color: '#232426',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
