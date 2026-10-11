'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  getPushPublicKeyAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  type PushSubscriptionInput,
} from '@/app/actions/push';

type State = 'loading' | 'unsupported' | 'off' | 'on' | 'denied' | 'busy';

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // The worker normally registers on load (ServiceWorker.tsx); make sure it exists even
  // when the bell is tapped first.
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');
}

/**
 * The bell in the header: turns push notifications on or off for THIS device. Each
 * phone and computer subscribes on its own, which is how the browser's permission works.
 * iPhones only allow it once the app has been added to the home screen.
 */
export function PushToggle() {
  const t = useTranslations('push');
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('off'));
  }, []);

  const toggle = async () => {
    setError(false);
    if (state === 'unsupported' || state === 'denied') {
      window.alert(state === 'unsupported' ? t('unsupported') : t('denied'));
      return;
    }
    const was = state;
    setState('busy');
    try {
      const reg = await registration();
      if (was === 'on') {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await removePushSubscriptionAction(sub.endpoint);
          await sub.unsubscribe();
        }
        setState('off');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const ready = await navigator.serviceWorker.ready;
      const key = await getPushPublicKeyAction();
      const sub =
        (await ready.pushManager.getSubscription()) ??
        (await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(key),
        }));
      const ok = await savePushSubscriptionAction(sub.toJSON() as PushSubscriptionInput);
      setState(ok ? 'on' : 'off');
      if (!ok) setError(true);
    } catch {
      setState(was === 'busy' ? 'off' : was);
      setError(true);
    }
  };

  if (state === 'loading') return null;
  const on = state === 'on';
  const label = on ? t('on') : t('off');

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={state === 'busy'}
      title={error ? t('failed') : on ? t('turnOff') : t('turnOn')}
      aria-label={label}
      aria-pressed={on}
      className={clsx(
        'relative flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[0.8125rem] hover:bg-white/10',
        on ? 'border-teal-400/60 text-white' : 'border-white/20 text-white/70',
        error && 'border-red-400',
      )}
    >
      <span aria-hidden className={clsx('text-base leading-none', state === 'busy' && 'animate-pulse')}>
        {on ? '🔔' : '🔕'}
      </span>
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
