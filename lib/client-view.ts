import 'server-only';

import type { NotRepairedReason } from '@prisma/client';

import { getOverview } from './analytics';
import { endOfLocalDayExclusive, startOfLocalDay } from './dates';
import { buildPartsUsageReport, type PartsUsageReport } from './exports/parts-usage';
import { prisma } from './prisma';
import { getActiveProject, projectScopeWhere } from './projects';
import { isBlank } from './text';

/**
 * Everything Jti's supervisor is allowed to see, and nothing else.
 *
 * The redaction lives HERE rather than in the components, deliberately. A page that
 * fetches a wage and then declines to render it has still sent it to the browser, where
 * it sits in the RSC payload for anyone who opens dev tools. So these functions return
 * shapes that never carried the value at all: no wage, no rate, no technician identity,
 * no photo reference, and nothing outside the active project.
 *
 * The manager's mirror of this surface calls these same functions, so what the manager
 * sees is what Jti sees, redactions included. That is the point of the surface — two
 * parties reading one set of figures, rather than each believing a different number.
 */

/** Jti is locked to the campaign that is active. Not a filter they can widen. */
export async function getClientScope() {
  const project = await getActiveProject();
  if (!project) return null;
  return { projectId: project.id, projectName: project.name };
}

export interface ClientCityRow {
  cityName: string;
  /** Stands repaired, within-project re-repairs excluded (§6.3). */
  repaired: number;
  notRepaired: number;
  reRepairs: number;
  /** Order lines still awaiting a visit. */
  remaining: number;
  totalOrdered: number;
}

export interface ClientReportCard {
  cities: ClientCityRow[];
  totals: {
    repaired: number;
    notRepaired: number;
    reRepairs: number;
    remaining: number;
    totalOrdered: number;
    successRate: number;
  };
  /** Why visits produced no repair. Most of these are Jti's to act on, not ours. */
  reasons: Array<{ reason: NotRepairedReason; count: number }>;
  /** So both sides can say "as of" and mean the same instant. */
  generatedAt: string;
}

/**
 * Coverage against Jti's own order file, plus the reasons visits failed.
 *
 * Built on getOverview so these figures cannot drift from the manager's dashboard — but
 * every wage field is dropped on the way out. `wageTotal` exists on CityStats and must
 * not survive this function.
 */
export async function getClientReportCard(projectId: string): Promise<ClientReportCard> {
  const overview = await getOverview({ projectId });

  return {
    cities: overview.cities.map((c) => ({
      cityName: c.cityName,
      repaired: c.repaired,
      notRepaired: c.notRepaired,
      reRepairs: c.reRepairs,
      remaining: c.remaining,
      totalOrdered: c.totalOrdered,
    })),
    totals: {
      repaired: overview.totals.repaired,
      notRepaired: overview.totals.notRepaired,
      reRepairs: overview.totals.reRepairs,
      remaining: overview.totals.remaining,
      totalOrdered: overview.totals.totalOrdered,
      successRate: overview.totals.successRate,
    },
    reasons: overview.reasons,
    generatedAt: overview.generatedAt,
  };
}

/** One row of fieldwork as Jti may see it: the work, never who did it. */
export interface ClientFormRow {
  id: string;
  formCode: string;
  date: Date;
  uid: string;
  standIndex: number;
  cityName: string;
  storeName: string;
  outcome: 'REPAIRED' | 'NOT_REPAIRED';
  notRepairedReason: NotRepairedReason | null;
  qualityScore: number | null;
  isReRepair: boolean;
  parts: Array<{
    nameFa: string;
    nameEn: string;
    quantity: number;
    action: 'REPLACED' | 'REPAIRED';
  }>;
  /** Queries raised on this form, so both sides see the same open question. */
  queryCount: number;
}

/**
 * The select behind every list Jti sees. Written once so a column cannot be added to one
 * list later and quietly leak what the other lists withhold.
 */
const CLIENT_FORM_SELECT = {
  id: true,
  formCode: true,
  date: true,
  uid: true,
  standIndex: true,
  outcome: true,
  notRepairedReason: true,
  qualityScore: true,
  isReRepair: true,
  storeName: true,
  city: { select: { name: true } },
  parts: {
    select: {
      quantity: true,
      action: true,
      part: { select: { nameFa: true, nameEn: true } },
    },
  },
  _count: { select: { queries: true } },
} as const;

interface RawClientForm {
  id: string;
  formCode: string;
  date: Date;
  uid: string;
  standIndex: number;
  outcome: string;
  notRepairedReason: NotRepairedReason | null;
  qualityScore: number | null;
  isReRepair: boolean;
  storeName: string | null;
  city: { name: string } | null;
  parts: Array<{
    quantity: number;
    action: string;
    part: { nameFa: string; nameEn: string };
  }>;
  _count: { queries: number };
}

function toClientRow(f: RawClientForm): ClientFormRow {
  return {
    id: f.id,
    formCode: f.formCode,
    date: f.date,
    uid: f.uid,
    standIndex: f.standIndex,
    cityName: f.city?.name ?? '—',
    // Falls back to the uid for a blank name — and isBlank counts the "[object Object]"
    // left in the archive as blank, because a client should see the uid, not our bug.
    storeName: isBlank(f.storeName) ? f.uid : (f.storeName as string),
    outcome: f.outcome as 'REPAIRED' | 'NOT_REPAIRED',
    notRepairedReason: f.notRepairedReason,
    qualityScore: f.qualityScore,
    isReRepair: f.isReRepair,
    parts: f.parts.map((p) => ({
      nameFa: p.part.nameFa,
      nameEn: p.part.nameEn,
      quantity: p.quantity,
      action: p.action as 'REPLACED' | 'REPAIRED',
    })),
    queryCount: f._count.queries,
  };
}

/**
 * Today's fieldwork, on the Tehran-local day boundary the rest of the app uses. A client
 * watching progress at 1 a.m. must see the same "today" the manager does.
 */
export async function getClientToday(projectId: string): Promise<ClientFormRow[]> {
  const now = new Date();
  const forms = await prisma.repairForm.findMany({
    where: {
      ...projectScopeWhere(projectId),
      date: { gte: startOfLocalDay(now), lt: endOfLocalDayExclusive(now) },
    },
    orderBy: { date: 'desc' },
    select: CLIENT_FORM_SELECT,
  });
  return (forms as RawClientForm[]).map(toClientRow);
}

/** §6.3 — stands repaired twice inside this campaign. */
export async function getClientReRepairs(projectId: string): Promise<ClientFormRow[]> {
  const forms = await prisma.repairForm.findMany({
    where: { ...projectScopeWhere(projectId), isReRepair: true },
    orderBy: { date: 'desc' },
    select: CLIENT_FORM_SELECT,
  });
  return (forms as RawClientForm[]).map(toClientRow);
}

export interface ClientFormsPage {
  rows: ClientFormRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Every report in the campaign, paged. */
export async function getClientForms(
  projectId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<ClientFormsPage> {
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const where = projectScopeWhere(projectId);

  const [rows, total] = await Promise.all([
    prisma.repairForm.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: CLIENT_FORM_SELECT,
    }),
    prisma.repairForm.count({ where }),
  ]);

  return { rows: (rows as RawClientForm[]).map(toClientRow), total, page, pageSize };
}

/**
 * Parts consumed: total per part, and how many stands needed it (§10).
 *
 * buildPartsUsageReport carries no prices, so it passes through unchanged. Only replaced
 * parts count as consumed inventory (§6.8), which is the figure that matters here.
 */
export async function getClientPartsUsage(projectId: string): Promise<PartsUsageReport> {
  return buildPartsUsageReport({ projectId });
}

/**
 * One visit, and the conversation about it.
 *
 * Authorship is reduced to a side, not a person: "Jti" or "the repair team". Naming the
 * manager who replied would be harmless, but naming the technician whose work is being
 * questioned would not — it turns a query about a stand into a complaint about a named
 * individual, and this panel withholds technician identity everywhere else.
 */
export type QuerySide = 'CLIENT' | 'TEAM';

export interface ClientQueryMessage {
  id: string;
  body: string;
  createdAt: Date;
  side: QuerySide;
}

export interface ClientQueryThread {
  id: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  createdAt: Date;
  resolvedAt: Date | null;
  messages: ClientQueryMessage[];
}

export interface ClientFormDetail extends ClientFormRow {
  storeAddress: string | null;
  timeSpentMinutes: number | null;
  notes: string | null;
  queries: ClientQueryThread[];
}

const sideOf = (role: string): QuerySide =>
  role === 'CLIENT_SUPERVISOR' ? 'CLIENT' : 'TEAM';

/**
 * A single form, scoped to the campaign.
 *
 * Scoped deliberately: a form id is guessable enough that "the id was in the URL" is not
 * an authorisation argument. A form from an earlier project returns null here even
 * though it exists.
 */
export async function getClientFormDetail(
  projectId: string,
  formId: string,
): Promise<ClientFormDetail | null> {
  const form = await prisma.repairForm.findFirst({
    where: { id: formId, ...projectScopeWhere(projectId) },
    select: {
      ...CLIENT_FORM_SELECT,
      storeAddress: true,
      timeSpentMinutes: true,
      notes: true,
      queries: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              body: true,
              createdAt: true,
              author: { select: { role: true } },
            },
          },
        },
      },
    },
  });

  if (!form) return null;

  const raw = form as unknown as RawClientForm & {
    storeAddress: string | null;
    timeSpentMinutes: number | null;
    notes: string | null;
    queries: Array<{
      id: string;
      status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
      createdAt: Date;
      resolvedAt: Date | null;
      messages: Array<{
        id: string;
        body: string;
        createdAt: Date;
        author: { role: string };
      }>;
    }>;
  };

  return {
    ...toClientRow(raw),
    storeAddress: isBlank(raw.storeAddress) ? null : raw.storeAddress,
    timeSpentMinutes: raw.timeSpentMinutes,
    notes: isBlank(raw.notes) ? null : raw.notes,
    queries: raw.queries.map((q) => ({
      id: q.id,
      status: q.status,
      createdAt: q.createdAt,
      resolvedAt: q.resolvedAt,
      messages: q.messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        side: sideOf(m.author.role),
      })),
    })),
  };
}

export interface QueryListItem extends ClientQueryThread {
  formId: string;
  formCode: string;
  uid: string;
  storeName: string;
  cityName: string;
  date: Date;
}

/**
 * Every thread in the campaign, newest first, unresolved before resolved.
 *
 * Both sides read this same list. The manager needs it to find what is waiting on them;
 * Jti needs it to see what they have asked and what came back, without hunting through
 * a thousand forms for the one they queried.
 */
export async function getQueryThreads(
  projectId: string,
  opts: { openOnly?: boolean } = {},
): Promise<QueryListItem[]> {
  const threads = await prisma.formQuery.findMany({
    where: {
      repairForm: projectScopeWhere(projectId),
      ...(opts.openOnly ? { status: { not: 'RESOLVED' } } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      repairForm: {
        select: {
          id: true,
          formCode: true,
          uid: true,
          storeName: true,
          date: true,
          city: { select: { name: true } },
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { role: true } },
        },
      },
    },
  });

  return threads.map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    formId: t.repairForm.id,
    formCode: t.repairForm.formCode,
    uid: t.repairForm.uid,
    storeName: isBlank(t.repairForm.storeName) ? t.repairForm.uid : (t.repairForm.storeName as string),
    cityName: t.repairForm.city?.name ?? '—',
    date: t.repairForm.date,
    messages: t.messages.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      side: sideOf(m.author.role),
    })),
  }));
}

/** Waiting on the repair team: what the manager's badge counts. */
export async function countOpenQueries(projectId: string): Promise<number> {
  return prisma.formQuery.count({
    where: { repairForm: projectScopeWhere(projectId), status: { not: 'RESOLVED' } },
  });
}
