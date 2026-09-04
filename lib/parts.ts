/**
 * The 30-item part catalogue (spec §8).
 *
 * The order of this array IS the export layout: index 0 is Jti export column 5
 * (پلکسی شلف) and index 29 is column 34 (درب). `exportColumnKey` freezes that
 * relationship so the catalogue can never be silently reordered out from under a
 * previously-generated export.
 *
 * The Persian names are verbatim from the Jti spreadsheet and are used as the literal
 * column headers of the export regardless of UI locale.
 */

export const PART_EXPORT_FIRST_COLUMN = 5;
export const PART_EXPORT_LAST_COLUMN = 34;

export interface PartCatalogSeed {
  /** 1-based position within the 30 parts. */
  sortOrder: number;
  /** Column number in the Jti export (5..34). */
  exportColumn: number;
  exportColumnKey: string;
  nameFa: string;
  nameEn: string;
}

const NAMES: Array<[fa: string, en: string]> = [
  ['پلکسی شلف', 'Plexiglass shelf'],
  ['لایت باکس', 'Light box'],
  ['شلف روی در', 'Shelf on door'],
  ['کلید برق ۱۲ آمپر', '12A power switch'],
  ['سیم نمره ۱', 'Wire gauge 1'],
  ['سیم نمره ۰.۵', 'Wire gauge 0.5'],
  ['پایه فیوز', 'Fuse base'],
  ['فیوز', 'Fuse'],
  ['ترانس', 'Transformer'],
  ['میکروسوئیچ', 'Micro-switch'],
  ['پایه میکروسوئیچ', 'Micro-switch base'],
  ['سیم آداپتور', 'Adapter wire'],
  ['سیم تلفنی', 'Phone wire'],
  ['سوکت سیم تلفنی', 'Phone wire socket'],
  ['کابل ۳/۶۰', 'Cable 3/60'],
  ['سنت نگهدارنده', 'Holder clip'],
  ['لایت فریم', 'Light frame'],
  ['آرام بند', 'Door closer'],
  ['فنر', 'Spring'],
  ['برد استند', 'Stand board (PCB)'],
  ['نوار SMD سفید', 'White SMD strip'],
  ['نوار SMD آبی', 'Blue SMD strip'],
  ['کلید گرد', 'Round switch'],
  ['کلید مستطیلی', 'Rectangular switch'],
  ['ریل پوشر L', 'Pusher rail L'],
  ['ریل پوشر U', 'Pusher rail U'],
  ['سوکت کولری', 'Cooler socket'],
  ['درب پلاستیکی', 'Plastic door'],
  ['پلکسی سفید', 'White plexiglass'],
  ['درب', 'Door'],
];

export const PART_CATALOG: PartCatalogSeed[] = NAMES.map(([nameFa, nameEn], i) => {
  const exportColumn = PART_EXPORT_FIRST_COLUMN + i;
  return {
    sortOrder: i + 1,
    exportColumn,
    exportColumnKey: `col${String(exportColumn).padStart(2, '0')}`,
    nameFa,
    nameEn,
  };
});

if (PART_CATALOG.length !== PART_EXPORT_LAST_COLUMN - PART_EXPORT_FIRST_COLUMN + 1) {
  throw new Error(
    `Part catalogue must contain exactly ${
      PART_EXPORT_LAST_COLUMN - PART_EXPORT_FIRST_COLUMN + 1
    } items to fill export columns ${PART_EXPORT_FIRST_COLUMN}..${PART_EXPORT_LAST_COLUMN}`,
  );
}

/** The non-part columns of the Jti export, verbatim (spec §8). */
export const JTI_LEADING_HEADERS = ['رقم', 'تاریخ', 'شهر', 'شناسه'] as const;

export const JTI_TRAILING_HEADERS = [
  'Digital Address',
  'Address',
  'Maintenance detail',
  'Tel',
  'Store name',
  "Manager's name",
  'Technician code',
  'Form code',
  'Stand quality',
] as const;

/** All 43 headers in order. */
export const JTI_EXPORT_HEADERS: string[] = [
  ...JTI_LEADING_HEADERS,
  ...PART_CATALOG.map((p) => p.nameFa),
  ...JTI_TRAILING_HEADERS,
];

if (JTI_EXPORT_HEADERS.length !== 43) {
  throw new Error(`Jti export must have exactly 43 columns, got ${JTI_EXPORT_HEADERS.length}`);
}
