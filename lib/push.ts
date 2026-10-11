import 'server-only';

import webpush from 'web-push';

import { prisma } from './prisma';

/**
 * Phone/desktop push notifications (Web Push).
 *
 * The VAPID key pair that signs them is made on first use and kept in AppSetting, so a
 * server needs no extra configuration and the key survives restarts and upgrades. It
 * must never change once phones have subscribed: a new key silently orphans every
 * existing subscription.
 *
 * Delivery goes through the browser vendor's push service (Google for Chrome/Android,
 * Mozilla, Apple), so the server needs outbound HTTPS to those hosts. A failed send is
 * logged and never breaks the action that triggered it.
 */

const PUBLIC_KEY = 'push.vapidPublicKey';
const PRIVATE_KEY = 'push.vapidPrivateKey';

let configured: Promise<string> | null = null;

/** The public half, for the browser's subscribe call. Creates the pair if needed. */
export function vapidPublicKey(): Promise<string> {
  configured ??= (async () => {
    const [pub, priv] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: PUBLIC_KEY } }),
      prisma.appSetting.findUnique({ where: { key: PRIVATE_KEY } }),
    ]);
    let keys = pub && priv ? { publicKey: pub.value, privateKey: priv.value } : null;
    if (!keys) {
      const fresh = webpush.generateVAPIDKeys();
      // createMany + skipDuplicates: two first requests racing keep whichever pair won.
      await prisma.appSetting.createMany({
        data: [
          { key: PUBLIC_KEY, value: fresh.publicKey },
          { key: PRIVATE_KEY, value: fresh.privateKey },
        ],
        skipDuplicates: true,
      });
      const [p, q] = await Promise.all([
        prisma.appSetting.findUniqueOrThrow({ where: { key: PUBLIC_KEY } }),
        prisma.appSetting.findUniqueOrThrow({ where: { key: PRIVATE_KEY } }),
      ]);
      keys = { publicKey: p.value, privateKey: q.value };
    }
    const contact = await prisma.appSetting.findUnique({ where: { key: 'managerContactEmail' } });
    webpush.setVapidDetails(
      `mailto:${contact?.value || 'admin@sazkara.local'}`,
      keys.publicKey,
      keys.privateKey,
    );
    return keys.publicKey;
  })().catch((err) => {
    configured = null;
    throw err;
  });
  return configured;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. Same-origin path. */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking another. */
  tag?: string;
}

/** Send to every device of the given users. Returns how many deliveries succeeded. */
export async function sendPush(userIds: string[], message: PushMessage): Promise<number> {
  if (!userIds.length) return 0;
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (!subscriptions.length) return 0;
  await vapidPublicKey();

  const payload = JSON.stringify(message);
  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 24 * 3600 },
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed or the app was uninstalled. Forget it.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error('push delivery failed', status ?? '', (err as Error).message);
        }
      }
    }),
  );
  return delivered;
}

/**
 * Tell managers and crew leads about orders this uid's visit just finished.
 *
 * An order is finished when none of its lines is still PENDING. `completedNotifiedAt` is
 * claimed with a conditional update, so two technicians closing the last two lines at
 * once still produce one notification, and an order is never announced twice.
 */
export async function notifyFinishedOrders(uid: string): Promise<void> {
  const batches = await prisma.importBatch.findMany({
    where: {
      completedNotifiedAt: null,
      lines: { some: { uid } },
      NOT: { lines: { some: { status: 'PENDING' } } },
    },
    select: {
      id: true,
      name: true,
      project: { select: { name: true } },
      phase: { select: { name: true } },
      _count: { select: { lines: { where: { status: 'DONE' } } } },
    },
  });

  for (const batch of batches) {
    const claimed = await prisma.importBatch.updateMany({
      where: { id: batch.id, completedNotifiedAt: null },
      data: { completedNotifiedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const recipients = await prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'LEAD_TECHNICIAN'] }, status: 'APPROVED' },
      select: { id: true, role: true },
    });
    const where = [batch.project?.name, batch.phase?.name].filter(Boolean).join(' · ');
    const body = `${batch.name}${where ? ` (${where})` : ''} — ${batch._count.lines.toLocaleString('fa-IR')} UID انجام شد.`;
    const managers = recipients.filter((r) => r.role === 'MANAGER').map((r) => r.id);
    const leads = recipients.filter((r) => r.role === 'LEAD_TECHNICIAN').map((r) => r.id);

    await Promise.all([
      sendPush(managers, {
        title: 'سفارش تمام شد ✓',
        body,
        url: `/fa/manager/imports/${batch.id}`,
        tag: `order-${batch.id}`,
      }),
      sendPush(leads, {
        title: 'سفارش تمام شد ✓',
        body,
        url: '/fa/lead',
        tag: `order-${batch.id}`,
      }),
    ]);
  }
}
