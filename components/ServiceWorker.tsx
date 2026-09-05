'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker — and, in development, makes sure one is never running.
 *
 * A worker that serves hashed build assets cache-first is exactly wrong against a dev
 * server, where those paths change on every edit: it would hand back stale chunks and
 * break hot reload in ways that look like application bugs. So dev actively unregisters
 * anything left behind by a previous production build on the same localhost origin,
 * which is otherwise a genuinely confusing state to land in.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => void reg.unregister());
      });
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failing is not an application error — the app works without it.
      });
    };

    // Registering during load competes with the page's own requests for bandwidth, which
    // is the wrong trade on the connections this app is used over.
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
