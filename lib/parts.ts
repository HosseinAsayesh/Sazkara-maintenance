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

export type PartUnitName = 'PIECE' | 'CENTIMETER';

export interface PartCatalogSeed {
  /** 1-based position within the 30 parts. */
  sortOrder: number;
  /** Column number in the Jti export (5..34). */
  exportColumn: number;
  exportColumnKey: string;
  nameFa: string;
  nameEn: string;
  unit: PartUnitName;
  /** Step for the technician's quantity picker. */
  quantityStep: number;
}

/**
 * The SMD light strips are cut from a reel rather than fitted as units: they are
 * consumed in centimetres, in 50 cm increments (50, 100, 150, 200, ...). Everything else
 * is a discrete piece. Keyed by Persian name because that is the catalogue's identity.
 */
export const CENTIMETER_PARTS = new Set(['نوار SMD سفید', 'نوار SMD آبی']);

/** How much one tap adds for a centimetre-measured part. */
export const CENTIMETER_STEP = 50;

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
  // Column 34 / legacy column 32. Recorded as «درب» from a misread archive header; the
  // client confirmed against the source order files that the part is «پک هواکش». The
  // position is unchanged, so no export column moves — only the label was wrong, and it
  // was wrong in a way that silently filed vent packs against a door.
  ['پک هواکش', 'Vent pack'],
];

export const PART_CATALOG: PartCatalogSeed[] = NAMES.map(([nameFa, nameEn], i) => {
  const exportColumn = PART_EXPORT_FIRST_COLUMN + i;
  const isCm = CENTIMETER_PARTS.has(nameFa);
  return {
    sortOrder: i + 1,
    exportColumn,
    exportColumnKey: `col${String(exportColumn).padStart(2, '0')}`,
    nameFa,
    nameEn,
    unit: isCm ? 'CENTIMETER' : 'PIECE',
    quantityStep: isCm ? CENTIMETER_STEP : 1,
  };
});

if (PART_CATALOG.filter((p) => p.unit === 'CENTIMETER').length !== CENTIMETER_PARTS.size) {
  throw new Error(
    'A centimetre-measured part name no longer matches the catalogue. ' +
      'CENTIMETER_PARTS must use the exact Persian names from the Jti sheet.',
  );
}

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
  /**
   * Column 44, added at the client's request. The original spec fixed the sheet at 43
   * columns; this one states in words whether the visit ended in a repair and, when it
   * did not, which of the five fixed reasons applied — so a red row is readable without
   * relying on the fill colour surviving a copy-paste.
   */
  'Repair status',
] as const;

/** All 44 headers in order. */
export const JTI_EXPORT_HEADERS: string[] = [
  ...JTI_LEADING_HEADERS,
  ...PART_CATALOG.map((p) => p.nameFa),
  ...JTI_TRAILING_HEADERS,
];

/** 43 from the original spec plus the client-requested repair-status column. */
export const JTI_EXPORT_COLUMN_COUNT = 44;

if (JTI_EXPORT_HEADERS.length !== JTI_EXPORT_COLUMN_COUNT) {
  throw new Error(
    `Jti export must have exactly ${JTI_EXPORT_COLUMN_COUNT} columns, got ${JTI_EXPORT_HEADERS.length}`,
  );
}

/* ------------------------------------------------------------------ *
 * Legacy archive layout
 * ------------------------------------------------------------------ */

/**
 * The part columns of the Jti sheets used BEFORE this system existed: 28 columns rather
 * than today's 30. Two entries in the current catalogue simply had no column back then:
 *
 *   - `سیم نمره ۰.۵` (Wire gauge 0.5) — the archives only ever recorded gauge 1.
 *   - `کلید گرد` / `کلید مستطیلی` — the archives had a single merged "Switch" column.
 *
 * Kept in the original English wording of those sheets so a header row can be matched
 * against it, and ordered exactly as the columns appeared.
 */
export const LEGACY_PART_HEADERS = [
  'Plexiglass shelf',
  'Light box',
  'Door shelf',
  '12Amp electrical switch',
  'Gauge-1 wire',
  'Fuse holder',
  'Fuse',
  'Transformer',
  'Microswitch',
  'Microswitch base',
  'Adapter cable',
  'Telephone wire',
  'Telephone wire socket',
  'Cable 3/60',
  'Door holder catch',
  'Light frame',
  'Door closer',
  'Spring',
  'Stand board (PCB)',
  'White LED (SMD)',
  'Blue LED (SMD)',
  'Switch',
  'L rail and pusher',
  'U rail and pusher',
  'Cooler socket',
  'Plastic shelf cover/door',
  'White plexiglass',
  'Door',
] as const;

export const LEGACY_PART_COLUMN_COUNT = LEGACY_PART_HEADERS.length;

/**
 * Legacy column position (1-based) -> current catalogue `sortOrder`.
 *
 * The merged legacy "Switch" maps to `کلید گرد` (round switch) — the client's ruling.
 * Nothing maps onto `سیم نمره ۰.۵` (6) or `کلید مستطیلی` (24): those did not exist when
 * the archives were written, and inventing values for them would fabricate history.
 */
export const LEGACY_TO_CURRENT_SORT_ORDER: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5,
  6: 7, 7: 8, 8: 9, 9: 10, 10: 11,
  11: 12, 12: 13, 13: 14, 14: 15, 15: 16,
  16: 17, 17: 18, 18: 19, 19: 20, 20: 21,
  21: 22,
  22: 23, // merged "Switch" -> کلید گرد
  23: 25, 24: 26, 25: 27, 26: 28, 27: 29, 28: 30,
};

/** Catalogue entries that no legacy column feeds. */
export const SORT_ORDERS_ABSENT_FROM_LEGACY = PART_CATALOG.map((p) => p.sortOrder).filter(
  (order) => !Object.values(LEGACY_TO_CURRENT_SORT_ORDER).includes(order),
);

if (Object.keys(LEGACY_TO_CURRENT_SORT_ORDER).length !== LEGACY_PART_COLUMN_COUNT) {
  throw new Error(
    `Legacy map must cover all ${LEGACY_PART_COLUMN_COUNT} archive columns, ` +
      `got ${Object.keys(LEGACY_TO_CURRENT_SORT_ORDER).length}`,
  );
}

if (new Set(Object.values(LEGACY_TO_CURRENT_SORT_ORDER)).size !== LEGACY_PART_COLUMN_COUNT) {
  throw new Error('Legacy map must not send two archive columns to the same part');
}
