import 'server-only';

import ExcelJS from 'exceljs';

import { CATALOG_TO_JTI_PART, JTI_PART_COUNT, JTI_PART_HEADERS_FA, LEGACY_PART_HEADERS } from '../parts';
import { prisma } from '../prisma';
import { projectScopeWhere } from '../projects';

/**
 * Parts-usage totals (§6.8), in two models:
 *
 *  - ACCOUNTING — the 30 catalogue parts, each on its own row: round and rectangular
 *    switches apart, wire gauge 1 and 0.5 apart. What the accounting unit buys.
 *  - JTI — the 28 part columns of the Jti sheet, those two pairs merged into «کلید»
 *    and «سیم نمره1», exactly as the Jti export reports them.
 *
 * Two rules drive this report:
 *  - REPLACED parts only. A part repaired in place was never consumed from inventory
 *    and must not be billed.
 *  - Part prices are the same in every city, so the accounting total is a straight sum
 *    across all cities, broken down per part. The per-city columns are informational.
 *
 * Re-repairs ARE included: §6.3 excludes them from the *stand* count, not from parts.
 */

export type PartsReportModel = 'ACCOUNTING' | 'JTI';

export interface PartsUsageFilters {
  from?: Date;
  to?: Date;
  cityId?: string;
  projectId?: string | null;
  phaseId?: string | null;
  /** Defaults to ACCOUNTING. */
  model?: PartsReportModel;
}

export interface PartUsageRow {
  partId: string;
  nameFa: string;
  nameEn: string;
  sortOrder: number;
  /** cityName -> quantity replaced */
  perCity: Record<string, number>;
  total: number;
  /** How many distinct stands needed this part (drives the §10 percentage). */
  standCount: number;
}

export interface PartsUsageReport {
  model: PartsReportModel;
  rows: PartUsageRow[];
  cities: string[];
  grandTotal: number;
  /** Repaired stands in range — the denominator for "% of stands needing part X". */
  repairedStandCount: number;
}

export async function buildPartsUsageReport(
  filters: PartsUsageFilters,
): Promise<PartsUsageReport> {
  const formWhere = {
    outcome: 'REPAIRED' as const,
    ...projectScopeWhere(filters.projectId, filters.phaseId),
    ...(filters.cityId ? { cityId: filters.cityId } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
  };

  const [catalog, usages, repairedStands] = await Promise.all([
    // Repair-only work (soldering, gluing...) is never a consumed part.
    prisma.partCatalogItem.findMany({ where: { repairOnly: false }, orderBy: { sortOrder: 'asc' } }),
    prisma.partUsage.findMany({
      where: { action: 'REPLACED', repairForm: formWhere },
      select: {
        quantity: true,
        partCatalogItemId: true,
        repairForm: {
          select: { standId: true, city: { select: { name: true } } },
        },
      },
    }),
    // Distinct stands, so a stand repaired twice in range is one stand for the
    // "% of stands that needed part X" denominator (§10).
    prisma.repairForm.findMany({
      where: formWhere,
      select: { standId: true },
      distinct: ['standId'],
    }),
  ]);

  const model = filters.model ?? 'ACCOUNTING';

  // The row each catalogue part is totalled on: its own, or its Jti sheet column.
  const sortOrderById = new Map(catalog.map((p) => [p.id, p.sortOrder]));
  const rowKeyOf = (partId: string) =>
    model === 'JTI'
      ? `jti:${CATALOG_TO_JTI_PART[sortOrderById.get(partId) ?? 0] ?? 0}`
      : partId;

  const cities = new Set<string>();
  const byRow = new Map<string, { perCity: Map<string, number>; stands: Set<string> }>();

  for (const usage of usages) {
    const cityName = usage.repairForm.city?.name ?? 'نامشخص';
    cities.add(cityName);

    const key = rowKeyOf(usage.partCatalogItemId);
    let entry = byRow.get(key);
    if (!entry) {
      entry = { perCity: new Map(), stands: new Set() };
      byRow.set(key, entry);
    }
    entry.perCity.set(cityName, (entry.perCity.get(cityName) ?? 0) + usage.quantity);
    entry.stands.add(usage.repairForm.standId);
  }

  const cityList = [...cities].sort((a, b) => a.localeCompare(b, 'fa'));

  const rowShapes =
    model === 'JTI'
      ? Array.from({ length: JTI_PART_COUNT }, (_, i) => ({
          key: `jti:${i + 1}`,
          partId: `jti:${i + 1}`,
          nameFa: JTI_PART_HEADERS_FA[i],
          nameEn: LEGACY_PART_HEADERS[i],
          sortOrder: i + 1,
        }))
      : catalog.map((part) => ({
          key: part.id,
          partId: part.id,
          nameFa: part.nameFa,
          nameEn: part.nameEn,
          sortOrder: part.sortOrder,
        }));

  const rows: PartUsageRow[] = rowShapes.map((shape) => {
    const entry = byRow.get(shape.key);
    const perCity: Record<string, number> = {};
    let total = 0;
    for (const city of cityList) {
      const qty = entry?.perCity.get(city) ?? 0;
      perCity[city] = qty;
      total += qty;
    }
    return {
      partId: shape.partId,
      nameFa: shape.nameFa,
      nameEn: shape.nameEn,
      sortOrder: shape.sortOrder,
      perCity,
      total,
      standCount: entry?.stands.size ?? 0,
    };
  });

  return {
    model,
    rows,
    cities: cityList,
    grandTotal: rows.reduce((sum, r) => sum + r.total, 0),
    repairedStandCount: repairedStands.length,
  };
}

export async function buildPartsUsageWorkbook(
  report: PartsUsageReport,
  rangeLabel: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sazkara Maintenance';

  const sheet = workbook.addWorksheet('مصرف قطعات', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
  });

  sheet.addRow([
    report.model === 'JTI'
      ? 'گزارش مصرف قطعات — قالب جی‌تی‌آی، ۲۸ قطعه (فقط قطعات تعویض‌شده)'
      : 'گزارش مصرف قطعات — واحد حسابداری، ۳۰ قطعه (فقط قطعات تعویض‌شده)',
  ]);
  sheet.addRow([`بازه: ${rangeLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13 };
  sheet.getRow(2).font = { size: 10, color: { argb: 'FF666666' } };

  const headers = ['ردیف', 'قطعه', 'Part', ...report.cities, 'مجموع', '٪ استندها'];
  sheet.addRow(headers);

  const headerRow = sheet.getRow(3);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  for (const row of report.rows) {
    const pct =
      report.repairedStandCount > 0
        ? Math.round((row.standCount / report.repairedStandCount) * 1000) / 10
        : 0;
    sheet.addRow([
      row.sortOrder,
      row.nameFa,
      row.nameEn,
      ...report.cities.map((c) => row.perCity[c] ?? 0),
      row.total,
      pct,
    ]);
  }

  const totalRow = sheet.addRow([
    '',
    'مجموع کل',
    '',
    ...report.cities.map((c) => report.rows.reduce((s, r) => s + (r.perCity[c] ?? 0), 0)),
    report.grandTotal,
    '',
  ]);
  totalRow.font = { bold: true };

  sheet.getColumn(1).width = 7;
  sheet.getColumn(2).width = 24;
  sheet.getColumn(3).width = 22;
  for (let c = 4; c <= 3 + report.cities.length + 2; c++) {
    sheet.getColumn(c).width = 13;
    sheet.getColumn(c).alignment = { horizontal: 'center' };
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
