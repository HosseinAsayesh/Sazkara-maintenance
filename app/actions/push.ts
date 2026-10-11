'use server';

import { requireActionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendPush, vapidPublicKey } from '@/lib/push';

/** Push notifications are for the people who run the work: managers and crew leads. */
async function requireNotifiable() {
  const user = await requireActionUser();
  if (user.role !== 'MANAGER' && user.role !== 'LEAD_TECHNICIAN') throw new Error('FORBIDDEN');
  return user;
}

export async function getPushPublicKeyAction(): Promise<string> {
  await requireNotifiable();
  return vapidPublicKey();
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Remember this browser for the signed-in user. Keyed on the endpoint, so a phone handed
 * to someone else follows its new owner rather than notifying both.
 */
export async function savePushSubscriptionAction(sub: PushSubscriptionInput): Promise<boolean> {
  const user = await requireNotifiable();
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  // A confirmation on the device itself is the only proof the whole chain works.
  await sendPush([user.id], {
    title: 'اعلان‌ها فعال شد',
    body: 'از این پس پایان هر سفارش روی همین دستگاه اعلام می‌شود.',
    url: user.role === 'MANAGER' ? '/fa/manager' : '/fa/lead',
    tag: 'push-enabled',
  });
  return true;
}

export async function removePushSubscriptionAction(endpoint: string): Promise<void> {
  const user = await requireNotifiable();
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
}
