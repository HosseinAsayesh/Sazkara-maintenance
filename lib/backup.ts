import 'server-only';

import fs from 'node:fs/promises';
import { PassThrough, type Readable } from 'node:stream';

import archiver from 'archiver';
import ExcelJS from 'exceljs';

import { APP_TIMEZONE, formatJalali } from './dates';
import { buildJtiWorkbook, collectJtiRows } from './exports/jti';
import { prisma } from './prisma';
import { NO_PROJECT } from './projects';
import { getStorage } from './storage';

/**
 * The manager's own backup: a zip of whatever they tick, laid out so a person can find
 * things in it without the app.
 *
 *   پشتیبان سازکارا 1405-07-17 14-30/
 *     راهنما.txt                              what is inside, and anything missing
 *     پروژه‌ها.xlsx                            every project, its phases and counts
 *     <project>/
 *       سفارش‌ها/سفارش - <order> - <phase>.xlsx
 *       UIDها - <project> - <phase>.xlsx       the Jti sheet, one per phase
 *       تعمیرات مجدد - <project> - <phase>.xlsx
 *       عکس‌ها/<phase>/<city>/<uid>/<uid> - استند 2 - <form code> - <date> - قبل.jpg
 *
 * Every name says what it is — project, phase, uid, stand, form code, date — so a file
 * copied out of the folder on its own still identifies itself.
 *
 * Files are STORED, not compressed: photos are JPEGs and the sheets are zips already,
 * so deflating them again costs time for nothing. That also makes the archive size
 * predictable, which is what the browser's progress ring is drawn against.
 */

export const BACKUP_PARTS = ['projects', 'orders', 'uids', 'reRepairs', 'photos'] as const;
export type BackupPart = (typeof BACKUP_PARTS)[number];

export function isBackupPart(value: string): value is BackupPart {
  return (BACKUP_PARTS as readonly string[]).includes(value);
}

export interface BackupOptions {
  parts: Set<BackupPart>;
  /** One project, or every project (plus the reports filed under none). */
  projectId?: string;
}

type Entry =
  | { name: string; kind: 'buffer'; data: Buffer }
  | { name: string; kind: 'file'; ref: string; path: string | null; size: number };

export interface BackupPlan {
  /** The zip's file name, without `.zip`. Also its top-level folder. */
  rootName: string;
  entries: Entry[];
  /** Expected archive size in bytes — exact up to a little header overhead. */
  estimatedBytes: number;
}

/** A path segment safe on Windows, macOS and Linux alike. */
function seg(input: string | null | undefined, fallback: string): string {
  const cleaned = (input ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function dayLabel(date: Date): string {
  return formatJalali(date).replace(/\//g, '-');
}

/** `1405-07-17 14-30`: Jalali date and local time, safe as a file name. */
function stampLabel(now: Date): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return `${dayLabel(now)} ${time.replace(':', '-')}`;
}

const PHOTO_LABEL: Record<string, string> = {
  STORE: 'سردر فروشگاه',
  BEFORE: 'قبل',
  AFTER: 'بعد',
  STAMP: 'مهر فروشگاه',
  OTHER: 'سایر',
};

const LINE_STATUS: Record<string, string> = {
  PENDING: 'در انتظار بازدید',
  DONE: 'انجام شد',
  EXCLUDED: 'کنار گذاشته شد',
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
}

async function sheetBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

interface ProjectScope {
  /** Prisma project id, or NO_PROJECT for reports and orders filed under none. */
  id: string;
  name: string;
  code: string | null;
  startDate: Date | null;
  isActive: boolean;
  phases: Array<{ id: string; name: string }>;
}

async function loadScopes(projectId?: string): Promise<ProjectScope[]> {
  const projects = await prisma.project.findMany({
    where: projectId && projectId !== 'all' && projectId !== NO_PROJECT ? { id: projectId } : {},
    orderBy: { startDate: 'asc' },
    include: { phases: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } } },
  });
  const scopes: ProjectScope[] =
    projectId === NO_PROJECT
      ? []
      : projects.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          startDate: p.startDate,
          isActive: p.isActive,
          phases: p.phases,
        }));

  // Archive imports and anything filed before the project register sit under no project.
  if (!projectId || projectId === 'all' || projectId === NO_PROJECT) {
    const [forms, batches] = await Promise.all([
      prisma.repairForm.count({ where: { projectId: null } }),
      prisma.importBatch.count({ where: { projectId: null } }),
    ]);
    if (forms + batches > 0) {
      scopes.push({
        id: NO_PROJECT,
        name: 'بدون پروژه',
        code: null,
        startDate: null,
        isActive: false,
        phases: [],
      });
    }
  }
  return scopes;
}

const projectWhere = (scope: ProjectScope) =>
  scope.id === NO_PROJECT ? { projectId: null } : { projectId: scope.id };

/* ------------------------------------------------------------------ */

async function projectsWorkbook(scopes: ProjectScope[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  const sheet = workbook.addWorksheet('پروژه‌ها', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  sheet.addRow([
    'پروژه', 'کد', 'تاریخ شروع', 'فعال', 'فازها', 'سفارش‌ها', 'UID سفارش‌داده',
    'UID باقی‌مانده', 'گزارش‌ها', 'تعمیر شده', 'تعمیر نشده', 'تعمیر مجدد',
  ]);
  styleHeader(sheet.getRow(1));

  for (const scope of scopes) {
    const where = projectWhere(scope);
    const [orders, ordered, remaining, forms, repaired, notRepaired, reRepairs] =
      await Promise.all([
        prisma.importBatch.count({ where }),
        prisma.orderLine.count({ where: { batch: where, status: { not: 'EXCLUDED' } } }),
        prisma.orderLine.count({ where: { batch: where, status: 'PENDING' } }),
        prisma.repairForm.count({ where }),
        prisma.repairForm.count({ where: { ...where, outcome: 'REPAIRED', isReRepair: false } }),
        prisma.repairForm.count({ where: { ...where, outcome: 'NOT_REPAIRED', isReRepair: false } }),
        prisma.repairForm.count({ where: { ...where, isReRepair: true } }),
      ]);
    sheet.addRow([
      scope.name,
      scope.code ?? '',
      scope.startDate ? formatJalali(scope.startDate) : '',
      scope.isActive ? 'بله' : '',
      scope.phases.map((p) => p.name).join('، '),
      orders,
      ordered,
      remaining,
      forms,
      repaired,
      notRepaired,
      reRepairs,
    ]);
  }
  [26, 12, 12, 8, 30, 10, 14, 14, 10, 12, 12, 12].forEach(
    (w, i) => (sheet.getColumn(i + 1).width = w),
  );
  return sheetBuffer(workbook);
}

async function orderEntries(scope: ProjectScope, folder: string): Promise<Entry[]> {
  const batches = await prisma.importBatch.findMany({
    where: projectWhere(scope),
    orderBy: { importedAt: 'asc' },
    include: {
      phase: { select: { name: true } },
      lines: {
        orderBy: [{ cityName: 'asc' }, { uid: 'asc' }],
        include: { store: { select: { name: true, address: true, digitalAddress: true } } },
      },
    },
  });

  const entries: Entry[] = [];
  const used = new Set<string>();
  for (const batch of batches) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sazkara Maintenance';
    const sheet = workbook.addWorksheet('سفارش', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
    });
    sheet.addRow([`سفارش: ${batch.name}`]);
    sheet.addRow([
      `پروژه: ${scope.name} · فاز: ${batch.phase?.name ?? '—'} · تاریخ ورود: ${formatJalali(batch.importedAt)} · ${batch.lines.length} UID`,
    ]);
    sheet.getRow(1).font = { bold: true, size: 13 };
    sheet.getRow(2).font = { size: 10, color: { argb: 'FF666666' } };
    sheet.addRow([
      'ردیف', 'UID', 'شهر', 'نام فروشگاه', 'آدرس', 'لینک نقشه', 'مدیر فروشگاه', 'تلفن', 'وضعیت', 'توضیح تکراری',
    ]);
    styleHeader(sheet.getRow(3));
    batch.lines.forEach((l, i) =>
      sheet.addRow([
        i + 1,
        l.uid,
        l.cityName ?? '',
        l.store?.name ?? l.storeName ?? '',
        l.store?.address ?? l.address ?? '',
        l.store?.digitalAddress ?? l.digitalAddress ?? '',
        l.managerName ?? '',
        l.phone ?? '',
        LINE_STATUS[l.status] ?? l.status,
        l.duplicateNote ?? '',
      ]),
    );
    [6, 14, 12, 24, 40, 30, 18, 14, 16, 30].forEach(
      (w, i) => (sheet.getColumn(i + 1).width = w),
    );

    // Two orders may share a name; the import date keeps their files apart.
    let base = `سفارش - ${seg(batch.name, 'بی‌نام')} - ${seg(batch.phase?.name, 'بدون فاز')}`;
    if (used.has(base)) base += ` - ${dayLabel(batch.importedAt)}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);

    entries.push({
      name: `${folder}/سفارش‌ها/${name}.xlsx`,
      kind: 'buffer',
      data: await sheetBuffer(workbook),
    });
  }
  return entries;
}

/** The Jti sheet for one project, split by phase so each file names its phase. */
async function jtiEntries(
  scope: ProjectScope,
  folder: string,
  kind: 'MAIN' | 'RE_REPAIR',
): Promise<Entry[]> {
  const label = kind === 'MAIN' ? 'UIDها' : 'تعمیرات مجدد';
  const projectId = scope.id;
  const entries: Entry[] = [];

  const write = async (phaseId: string | null, phaseLabel: string) => {
    const rows = await collectJtiRows({ projectId, phaseId, scope: kind });
    if (!rows.length) return;
    const data = await buildJtiWorkbook(rows, kind, `${label} ${phaseLabel}`);
    entries.push({
      name: `${folder}/${label} - ${seg(scope.name, 'پروژه')} - ${seg(phaseLabel, 'فاز')}.xlsx`,
      kind: 'buffer',
      data,
    });
  };

  for (const phase of scope.phases) await write(phase.id, phase.name);

  // Reports on no phase (or a project with none) would be in no per-phase file, so the
  // project then also gets one sheet covering everything.
  const unphased =
    scope.id === NO_PROJECT
      ? 1
      : await prisma.repairForm.count({ where: { projectId: scope.id, phaseId: null } });
  if (unphased > 0 || scope.phases.length === 0) await write(null, 'همه فازها');

  return entries;
}

async function photoEntries(
  scope: ProjectScope,
  folder: string,
  missing: string[],
): Promise<Entry[]> {
  const storage = getStorage();
  const localPath =
    'absolutePath' in storage
      ? (ref: string) => (storage as { absolutePath(ref: string): string }).absolutePath(ref)
      : null;

  const forms = await prisma.repairForm.findMany({
    where: projectWhere(scope),
    orderBy: [{ date: 'asc' }, { formCode: 'asc' }],
    select: {
      formCode: true,
      uid: true,
      standIndex: true,
      date: true,
      technicianSignature: true,
      storeManagerSignature: true,
      phase: { select: { name: true } },
      city: { select: { name: true } },
      photos: { orderBy: { index: 'asc' }, select: { type: true, fileRef: true } },
    },
  });

  const entries: Entry[] = [];
  for (const form of forms) {
    const dir = [
      folder,
      'عکس‌ها',
      seg(form.phase?.name, 'بدون فاز'),
      seg(form.city?.name, 'شهر نامشخص'),
      seg(form.uid, 'UID'),
    ].join('/');
    const stem = `${seg(form.uid, 'UID')} - استند ${form.standIndex} - ${seg(form.formCode, '')} - ${dayLabel(form.date)}`;

    const files: Array<{ ref: string; label: string }> = [];
    const counts = new Map<string, number>();
    for (const photo of form.photos) {
      const n = (counts.get(photo.type) ?? 0) + 1;
      counts.set(photo.type, n);
      const base = PHOTO_LABEL[photo.type] ?? photo.type;
      files.push({ ref: photo.fileRef, label: n > 1 || photo.type === 'OTHER' ? `${base} ${n}` : base });
    }
    if (form.technicianSignature) files.push({ ref: form.technicianSignature, label: 'امضای تکنسین' });
    if (form.storeManagerSignature) {
      files.push({ ref: form.storeManagerSignature, label: 'امضای مدیر فروشگاه' });
    }

    for (const file of files) {
      const ext = (file.ref.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.jpg').toLowerCase();
      const name = `${dir}/${stem} - ${file.label}${ext}`;
      const path = localPath ? localPath(file.ref) : null;
      let size = 0;
      try {
        size = path ? (await fs.stat(path)).size : (await storage.get(file.ref)).length;
      } catch {
        missing.push(`${name}  (${file.ref})`);
        continue;
      }
      entries.push({ name, kind: 'file', ref: file.ref, path, size });
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */

const PART_LABEL: Record<BackupPart, string> = {
  projects: 'فهرست پروژه‌ها',
  orders: 'سفارش‌ها',
  uids: 'اکسل UIDها',
  reRepairs: 'اکسل تعمیرات مجدد',
  photos: 'عکس‌ها و امضاها',
};

/** Decide everything that goes into the zip, and how big it will be. */
export async function planBackup(options: BackupOptions): Promise<BackupPlan> {
  const now = new Date();
  const scopes = await loadScopes(options.projectId);
  const single = scopes.length === 1 && options.projectId && options.projectId !== 'all';
  const rootName = seg(
    `پشتیبان سازکارا${single ? ` - ${scopes[0].name}` : ''} ${stampLabel(now)}`,
    'Sazkara backup',
  );

  const entries: Entry[] = [];
  const missing: string[] = [];

  if (options.parts.has('projects')) {
    entries.push({
      name: `${rootName}/پروژه‌ها.xlsx`,
      kind: 'buffer',
      data: await projectsWorkbook(scopes),
    });
  }

  for (const scope of scopes) {
    const folder = `${rootName}/${seg(scope.name, 'پروژه')}`;
    if (options.parts.has('orders')) entries.push(...(await orderEntries(scope, folder)));
    if (options.parts.has('uids')) entries.push(...(await jtiEntries(scope, folder, 'MAIN')));
    if (options.parts.has('reRepairs')) {
      entries.push(...(await jtiEntries(scope, folder, 'RE_REPAIR')));
    }
    if (options.parts.has('photos')) entries.push(...(await photoEntries(scope, folder, missing)));
  }

  const photoCount = entries.filter((e) => e.kind === 'file').length;
  const readme = [
    'پشتیبان سامانه نگهداری سازکارا',
    `تاریخ تهیه: ${formatJalali(now)} — ${stampLabel(now).split(' ')[1].replace('-', ':')}`,
    `پروژه‌ها: ${scopes.map((s) => s.name).join('، ') || '—'}`,
    `شامل: ${[...options.parts].map((p) => PART_LABEL[p]).join('، ')}`,
    `تعداد فایل‌ها: ${entries.length + 1} (عکس و امضا: ${photoCount})`,
    '',
    'نام هر فایل پروژه، فاز، UID، شماره‌ی استند، کد فرم و تاریخ را در خود دارد تا جدا از این پوشه هم شناخته شود.',
    '',
    missing.length
      ? `فایل‌هایی که در سرور پیدا نشدند و در این پشتیبان نیستند (${missing.length}):\n${missing.join('\n')}`
      : 'همه‌ی فایل‌های خواسته‌شده در این پشتیبان هست.',
    '',
  ].join('\r\n');
  entries.unshift({ name: `${rootName}/راهنما.txt`, kind: 'buffer', data: Buffer.from(`﻿${readme}`, 'utf8') });

  // Stored entries: the data, plus a local header, a data descriptor and a central
  // directory record per file, each carrying the (UTF-8) name; zip64 fields when large.
  const estimatedBytes =
    entries.reduce((sum, e) => {
      const nameBytes = Buffer.byteLength(e.name);
      const size = e.kind === 'buffer' ? e.data.length : e.size;
      return sum + size + 2 * nameBytes + 30 + 24 + 46 + 40;
    }, 0) + 98;

  return { rootName, entries, estimatedBytes };
}

/** Stream the planned zip. Photos are read from disk one at a time as the zip reaches them. */
export function streamBackup(plan: BackupPlan): Readable {
  const archive = archiver('zip', { store: true });
  const out = new PassThrough();
  archive.on('warning', (err) => console.warn('backup warning', err));
  archive.on('error', (err) => out.destroy(err));
  archive.pipe(out);

  const storage = getStorage();
  void (async () => {
    try {
      for (const entry of plan.entries) {
        if (entry.kind === 'buffer') {
          archive.append(entry.data, { name: entry.name });
        } else if (entry.path) {
          // archive.file opens the file lazily, so thousands of photos never hold
          // thousands of open handles.
          archive.file(entry.path, { name: entry.name });
        } else {
          archive.append(await storage.get(entry.ref), { name: entry.name });
        }
      }
      await archive.finalize();
    } catch (err) {
      out.destroy(err as Error);
    }
  })();

  return out;
}
