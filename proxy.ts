/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. It runs on the Node.js runtime
 * (the Edge runtime is not supported here), so `jose` verification is fine.
 *
 * This is an *optimistic* gate only — it avoids rendering a page the user cannot see.
 * Every page and API route re-checks the session server-side against the database, so a
 * revoked account cannot ride a still-valid cookie past this point.
 */

import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { SESSION_COOKIE, verifySession } from './lib/session';

const handleI18nRouting = createMiddleware(routing);

/** Reachable without a session, matched after the locale prefix is stripped. */
const PUBLIC_PATHS = ['/login', '/register', '/pending'];

const LOCALES = routing.locales as readonly string[];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const response = handleI18nRouting(request);

  // Split `/fa/manager/exports` into locale + `/manager/exports`.
  const segments = pathname.split('/').filter(Boolean);
  const hasLocale = LOCALES.includes(segments[0]);
  const locale = hasLocale ? segments[0] : routing.defaultLocale;
  const rest = `/${segments.slice(hasLocale ? 1 : 0).join('/')}`;

  if (rest === '/' || PUBLIC_PATHS.some((p) => rest === p || rest.startsWith(`${p}/`))) {
    return response;
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  const wrongArea =
    (rest.startsWith('/manager') && session.role !== 'MANAGER') ||
    (rest.startsWith('/technician') && session.role !== 'TECHNICIAN');

  if (wrongArea) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/${session.role === 'MANAGER' ? 'manager' : 'technician'}`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Everything except API routes (they authenticate themselves), Next internals and
  // anything with a file extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
