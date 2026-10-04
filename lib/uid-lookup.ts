import 'server-only';

import { prisma } from './prisma';
import { normaliseUid } from './text';

/**
 * Looking a uid up while it is being typed, and seeing its photos.
 *
 * Suggestions put the open order rows first — the uids a technician is actually sent to
 * — and then every other uid the database knows, so a stray stand can still be found.
 * Picking from the list instead of typing the whole code is what keeps a mistyped uid
 * from turning into a new "pending" stand.
 */

export interface UidSuggestion {
  uid: string;
  storeName: string | null;
  cityName: string | null;
  /** ORDER: an open row in a current order. HISTORY: known from earlier work. */
  kind: 'ORDER' | 'HISTORY';
}

export const SUGGEST_MIN_CHARS = 2;
const LIMIT = 10;

/** Rows starting with the typed text come before rows merely containing it. */
function rank<T extends { uid: string }>(rows: T[], q: string): T[] {
  return [...rows].sort((a, b) => {
    const pa = a.uid.startsWith(q) ? 0 : 1;
    const pb = b.uid.startsWith(q) ? 0 : 1;
    return pa - pb || a.uid.localeCompare(b.uid);
  });
}

export async function suggestUids(input: string): Promise<UidSuggestion[]> {
  const q = normaliseUid(input);
  if (q.length < SUGGEST_MIN_CHARS) return [];

  const lines = await prisma.orderLine.findMany({
    where: { status: 'PENDING', uid: { contains: q, mode: 'insensitive' } },
    orderBy: [{ batch: { project: { isActive: 'desc' } } }, { createdAt: 'desc' }],
    take: 40,
    select: {
      uid: true,
      storeName: true,
      cityName: true,
      store: { select: { name: true, city: { select: { name: true } } } },
    },
  });

  const seen = new Set<string>();
  const out: UidSuggestion[] = [];
  for (const line of rank(lines, q)) {
    if (seen.has(line.uid) || out.length >= LIMIT) continue;
    seen.add(line.uid);
    out.push({
      uid: line.uid,
      storeName: line.storeName ?? line.store?.name ?? null,
      cityName: line.cityName ?? line.store?.city.name ?? null,
      kind: 'ORDER',
    });
  }
  if (out.length >= LIMIT) return out;

  const stores = await prisma.store.findMany({
    where: {
      uid: { contains: q, mode: 'insensitive', notIn: [...seen] },
      confirmation: { not: 'REJECTED' },
    },
    take: 40,
    select: { uid: true, name: true, city: { select: { name: true } } },
  });
  for (const store of rank(stores, q)) {
    if (out.length >= LIMIT) break;
    out.push({
      uid: store.uid,
      storeName: store.name,
      cityName: store.city.name,
      kind: 'HISTORY',
    });
  }
  return out;
}

export interface UidPhotoVisit {
  id: string;
  formCode: string;
  date: Date;
  standIndex: number;
  outcome: 'REPAIRED' | 'NOT_REPAIRED';
  isReRepair: boolean;
  technicianName: string;
  projectName: string | null;
  photos: Array<{ id: string; type: string; fileRef: string }>;
}

/** Every visit to a uid, newest first, with its photos. Visits without photos are kept
 * out: the page is for looking at pictures, and the history page lists every visit. */
export async function loadUidPhotos(input: string): Promise<{
  uid: string;
  storeName: string | null;
  cityName: string | null;
  visits: UidPhotoVisit[];
  /** Visits on record, with or without photos. */
  visitCount: number;
} | null> {
  const uid = normaliseUid(input);
  if (!uid) return null;
  const store = await prisma.store.findUnique({
    where: { uid },
    select: {
      uid: true,
      name: true,
      city: { select: { name: true } },
      repairForms: {
        orderBy: [{ date: 'desc' }, { standIndex: 'asc' }],
        select: {
          id: true,
          formCode: true,
          date: true,
          standIndex: true,
          outcome: true,
          isReRepair: true,
          technician: { select: { name: true } },
          project: { select: { name: true } },
          photos: {
            orderBy: { index: 'asc' },
            select: { id: true, type: true, fileRef: true },
          },
        },
      },
    },
  });
  if (!store) return null;

  // Store, before, after, stamp, then the extra photos — the order they are taken in.
  const ORDER: Record<string, number> = { STORE: 0, BEFORE: 1, AFTER: 2, STAMP: 3, OTHER: 4 };
  const visits = store.repairForms
    .filter((f) => f.photos.length > 0)
    .map((f) => ({
      id: f.id,
      formCode: f.formCode,
      date: f.date,
      standIndex: f.standIndex,
      outcome: f.outcome,
      isReRepair: f.isReRepair,
      technicianName: f.technician.name,
      projectName: f.project?.name ?? null,
      photos: [...f.photos].sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9)),
    }));

  return {
    uid: store.uid,
    storeName: store.name,
    cityName: store.city.name,
    visits,
    visitCount: store.repairForms.length,
  };
}
