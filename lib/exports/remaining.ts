import 'server-only';

import ExcelJS from 'exceljs';

import { formatJalali } from '../dates';
import { prisma } from '../prisma';

/**
 * The UIDs still waiting for a visit — the dashboard's «remaining» figure, as a sheet the
 * manager can hand out or plan routes from. One row per outstanding order line, read with
 * the same rule the dashboard counts by: PENDING lines only (EXCLUDED lines were dropped
 * from the campaign at import), scoped by the project/phase of the order they came in on.
 */
export interface RemainingFilters {
  projectId?: string;
  phaseId?: string;
  cityId?: string;
}

export interface RemainingRow {
  uid: string;
  cityName: string;
  storeName: string;
  address: string;
  digitalAddress: string;
  managerName: string;
  phone: string;
  orderName: string;
  projectName: string;
  phaseName: string;
  orderedAt: Date;
}

export async function collectRemainingRows(filters: RemainingFilters): Promise<RemainingRow[]> {
  const city = filters.cityId
    ? await prisma.city.findUnique({ where: { id: filters.cityId }, select: { name: true } })
    : null;

  const lines = await prisma.orderLine.findMany({
    where: {
      status: 'PENDING',
      ...(filters.projectId && filters.projectId !== 'all'
        ? {
            batch: {
              projectId: filters.projectId === '__none__' ? null : filters.projectId,
              ...(filters.phaseId && filters.phaseId !== 'all'
                ? { phaseId: filters.phaseId }
                : {}),
            },
          }
        : {}),
      ...(city ? { cityName: city.name } : {}),
    },
    orderBy: [{ cityName: 'asc' }, { uid: 'asc' }],
    include: {
      store: { select: { name: true, address: true, digitalAddress: true, managerName: true, phone: true } },
      batch: {
        select: {
          name: true,
          importedAt: true,
          project: { select: { name: true } },
          phase: { select: { name: true } },
        },
      },
    },
  });

  // What the store record knows wins over the order row's snapshot: technicians correct
  // stale Jti details on site, and a route planned from the old address wastes the trip.
  return lines.map((l) => ({
    uid: l.uid,
    cityName: l.cityName ?? '',
    storeName: l.store?.name ?? l.storeName ?? '',
    address: l.store?.address ?? l.address ?? '',
    digitalAddress: l.store?.digitalAddress ?? l.digitalAddress ?? '',
    managerName: l.store?.managerName ?? l.managerName ?? '',
    phone: l.store?.phone ?? l.phone ?? '',
    orderName: l.batch.name,
    projectName: l.batch.project?.name ?? '',
    phaseName: l.batch.phase?.name ?? '',
    orderedAt: l.batch.importedAt,
  }));
}

export async function buildRemainingWorkbook(
  rows: RemainingRow[],
  title: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('UIDهای باقی‌مانده', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
  });

  sheet.addRow([`UIDهای باقی‌مانده — ${title}`]);
  sheet.addRow([`${rows.length.toLocaleString('fa-IR')} مورد · تهیه‌شده در ${formatJalali(new Date())}`]);
  sheet.getRow(1).font = { bold: true, size: 13 };
  sheet.getRow(2).font = { size: 10, color: { argb: 'FF666666' } };

  const headers = [
    'ردیف', 'UID', 'شهر', 'نام فروشگاه', 'آدرس', 'لینک نقشه', 'مدیر فروشگاه', 'تلفن',
    'سفارش', 'پروژه', 'فاز', 'تاریخ سفارش',
  ];
  sheet.addRow(headers);
  const headerRow = sheet.getRow(3);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  rows.forEach((r, i) => {
    const added = sheet.addRow([
      i + 1,
      r.uid,
      r.cityName,
      r.storeName,
      r.address,
      r.digitalAddress,
      r.managerName,
      r.phone,
      r.orderName,
      r.projectName,
      r.phaseName,
      formatJalali(r.orderedAt),
    ]);
    // A map link is only useful if it can be clicked.
    if (/^https?:\/\//i.test(r.digitalAddress)) {
      added.getCell(6).value = { text: r.digitalAddress, hyperlink: r.digitalAddress };
      added.getCell(6).font = { color: { argb: 'FF1F5FBF' }, underline: true };
    }
  });

  const widths = [6, 14, 12, 24, 40, 30, 18, 14, 22, 18, 12, 12];
  widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  sheet.getColumn(5).alignment = { wrapText: true, vertical: 'top' };
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
