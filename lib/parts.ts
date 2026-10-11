import { NOT_REPAIRED_REASONS, REASON_INFO } from './reasons';

/**
 * The 30-item part catalogue (spec §8) — what a technician picks from, and what the
 * accounting parts report lists one by one.
 *
 * `exportColumnKey` (col05..col34) is the part's permanent identity in the database; it
 * no longer names a column of the Jti sheet. That sheet has 28 part columns, and two
 * pairs of catalogue parts share one of them there (see CATALOG_TO_JTI_PART below).
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
 * Parts cut to length rather than fitted as units, with the length one tap adds: the SMD
 * light strips in 30 cm cuts, the wires in 10 cm (client, 2026-10 — the strips were
 * 50 cm cuts and the wires whole pieces before). Everything else is a discrete piece.
 * Keyed by Persian name because that is the catalogue's identity.
 */
export const CENTIMETER_STEPS: Record<string, number> = {
  'سیم نمره ۱': 10,
  'سیم نمره ۰.۵': 10,
  'نوار SMD سفید': 30,
  'نوار SMD آبی': 30,
};

export const CENTIMETER_PARTS = new Set(Object.keys(CENTIMETER_STEPS));

/**
 * Archive sheets (pre-system, and this system's own exports before 2026-10) counted
 * wire in pieces of 10 cm. Their quantities are multiplied by this on import so they
 * land in the centimetres the catalogue now records. Keyed by catalogue sortOrder.
 */
export const LEGACY_QUANTITY_FACTOR: Record<number, number> = { 5: 10, 6: 10 };

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
  // The Jti sheet's last part column. Briefly relabelled «پک هواکش»; the client has
  // since settled it as «درب», which is what their sheet has always said (2026-10).
  ['درب', 'Door'],
];

export const PART_CATALOG: PartCatalogSeed[] = NAMES.map(([nameFa, nameEn], i) => {
  const exportColumn = PART_EXPORT_FIRST_COLUMN + i;
  const cmStep = CENTIMETER_STEPS[nameFa];
  return {
    sortOrder: i + 1,
    exportColumn,
    exportColumnKey: `col${String(exportColumn).padStart(2, '0')}`,
    nameFa,
    nameEn,
    unit: cmStep ? 'CENTIMETER' : 'PIECE',
    quantityStep: cmStep ?? 1,
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
    } items (keys col${PART_EXPORT_FIRST_COLUMN}..col${PART_EXPORT_LAST_COLUMN})`,
  );
}

/* ------------------------------------------------------------------ *
 * The Jti sheet — the ONE Excel format, both imported and exported
 * ------------------------------------------------------------------ */

/**
 * The 28 part columns of the client's Jti sheet (row 2, columns 5..32), verbatim from
 * their files. Exports write these exact words; imports read quantities by position.
 */
export const JTI_PART_HEADERS_FA = [
  'شلف پلکسی', 'لایت باکس', 'شلف روی در', 'کلیدبرق12Amp', 'سیم نمره1',
  'پایه فیوز', 'فیوز', 'ترانس', 'میکروسوئیچ', 'پایه میکروسیچ',
  'سیم آداپتوری', 'سیم تلفنی', 'سوکت سیم تلفنی', 'کابل3/60', 'سنت نگهدارنده در',
  'لایت فریم', 'آرام بند', 'فنر', 'برد استند', '(smd)LEDسفید',
  '(smd)LEDآبی', 'کلید', 'ریل وپوشرL', 'ریل وپوشرU', 'سوکت کولری',
  'درب پلاستیکی شلف', 'پلکسی سفید', 'درب',
] as const;

export const JTI_FIRST_PART_COLUMN = 5;
export const JTI_PART_COUNT = JTI_PART_HEADERS_FA.length;

/**
 * Catalogue sortOrder -> Jti part column (1..28).
 *
 * The technician still picks the precise part, but the Jti sheet predates two splits:
 * both wire gauges are reported as «سیم نمره1», and the round and rectangular switches
 * as «کلید». The accounting report keeps them apart.
 */
export const CATALOG_TO_JTI_PART: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4,
  5: 5, 6: 5, // سیم نمره ۱ + سیم نمره ۰.۵ -> سیم نمره1
  7: 6, 8: 7, 9: 8, 10: 9, 11: 10, 12: 11, 13: 12, 14: 13, 15: 14,
  16: 15, 17: 16, 18: 17, 19: 18, 20: 19, 21: 20, 22: 21,
  23: 22, 24: 22, // کلید گرد + کلید مستطیلی -> کلید
  25: 23, 26: 24, 27: 25, 28: 26, 29: 27, 30: 28,
};

/** The sheet's first header row, columns 1..53, verbatim. Parts sit under «Problem Type». */
export const JTI_SHEET_HEADER_ROW: string[] = [
  '', 'Date', 'City', 'UID No.',
  'Problem Type', ...Array.from({ length: JTI_PART_COUNT - 1 }, () => ''),
  'location AddresS', 'Address', 'Store Details', 'Tel', "Store's Name",
  "Store Manager's Name", "Technician's Code+", 'Form code', 'Stand Quality',
  'Maintenance Services And Feedback',
  'Dubble',
  ...NOT_REPAIRED_REASONS.map((r) => REASON_INFO[r].labelFa),
];

/** Column numbers of the trailing block (1-based). */
export const JTI_COL = {
  digitalAddress: 33,
  address: 34,
  storeDetails: 35,
  tel: 36,
  store: 37,
  manager: 38,
  techCode: 39,
  formCode: 40,
  quality: 41,
  feedback: 42,
  dubble: 43,
  firstReason: 44,
} as const;

export const JTI_SHEET_COLUMN_COUNT = JTI_SHEET_HEADER_ROW.length;

if (JTI_SHEET_COLUMN_COUNT !== 53 || JTI_COL.firstReason + NOT_REPAIRED_REASONS.length - 1 !== 53) {
  throw new Error(`The Jti sheet must be 53 columns wide, got ${JTI_SHEET_COLUMN_COUNT}`);
}
if (new Set(Object.values(CATALOG_TO_JTI_PART)).size !== JTI_PART_COUNT) {
  throw new Error('Every Jti part column must be fed by at least one catalogue part');
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

/**
 * The shortened picker for parts REPAIRED IN PLACE.
 *
 * Replacing a part can be any of the thirty; repairing one in place is, in practice, a
 * much shorter list, and a technician scrolling thirty buttons on a phone in a shop to
 * find the six that ever apply is how the wrong one gets tapped. Client's list.
 *
 * Safe to shorten because §6.8 keeps repaired parts out of export columns 5-34 (they
 * export as 0 and are described in column 37 instead), so nothing here can move a
 * column or change what Jti is billed. The REPLACED picker still offers all thirty.
 *
 * Some buttons cover more than one catalogue part. The quantity is recorded against
 * `canonicalFa` and the button's own label is what column 37 prints, because "کلید" is
 * what the technician actually chose — printing "کلید گرد" would assert a shape nobody
 * recorded. The distinction is lost only for repairs, where no part is billed.
 */
/**
 * Repair work that involves no part at all (client, 2026-10). Each is a catalogue row of
 * its own, added by migration with `repairOnly` set, so a technician's tap is stored
 * like any other repaired item and reads back in the Store Details column — but it is
 * never offered as a replaced part and never reaches the part columns or the parts bill.
 * Their sortOrders follow the thirty parts; CATALOG_TO_JTI_PART deliberately has none.
 */
export const REPAIR_SERVICES = [
  { nameFa: 'رفع قطعی برق ورودی', nameEn: 'Restore incoming power', sortOrder: 31 },
  { nameFa: 'چسب کاری قطعات استند', nameEn: 'Glue stand parts', sortOrder: 32 },
  { nameFa: 'لحیم کاری', nameEn: 'Soldering', sortOrder: 33 },
] as const;

export interface RepairPickerGroup {
  /** Shown on the button, and printed in column 37. */
  labelFa: string;
  labelEn: string;
  /** Catalogue part the usage row is stored against. */
  canonicalFa: string;
  /** Every catalogue part this button stands for, canonical included. */
  membersFa: string[];
}

export const REPAIR_PICKER_GROUPS: RepairPickerGroup[] = [
  { labelFa: 'پلکسی شلف', labelEn: 'Plexiglass shelf', canonicalFa: 'پلکسی شلف', membersFa: ['پلکسی شلف'] },
  { labelFa: 'لایت فریم', labelEn: 'Light frame', canonicalFa: 'لایت فریم', membersFa: ['لایت فریم'] },
  { labelFa: 'نوار SMD سفید', labelEn: 'White SMD strip', canonicalFa: 'نوار SMD سفید', membersFa: ['نوار SMD سفید'] },
  { labelFa: 'نوار SMD آبی', labelEn: 'Blue SMD strip', canonicalFa: 'نوار SMD آبی', membersFa: ['نوار SMD آبی'] },
  {
    labelFa: 'کابل برق',
    labelEn: 'Power cable',
    canonicalFa: 'کابل ۳/۶۰',
    membersFa: ['کابل ۳/۶۰', 'سیم آداپتور'],
  },
  // Repairing a micro-switch in place means taking it out of the circuit (client, 2026-10).
  { labelFa: 'حذف میکروسوئیچ', labelEn: 'Remove micro-switch', canonicalFa: 'میکروسوئیچ', membersFa: ['میکروسوئیچ'] },
  { labelFa: 'فنر', labelEn: 'Spring', canonicalFa: 'فنر', membersFa: ['فنر'] },
  {
    labelFa: 'درب',
    labelEn: 'Door',
    canonicalFa: 'درب پلاستیکی',
    membersFa: ['درب پلاستیکی', 'شلف روی در'],
  },
  {
    labelFa: 'کلید',
    labelEn: 'Switch',
    canonicalFa: 'کلید گرد',
    membersFa: ['کلید گرد', 'کلید مستطیلی'],
  },
  { labelFa: 'برد استند', labelEn: 'Stand board (PCB)', canonicalFa: 'برد استند', membersFa: ['برد استند'] },
  // Work rather than parts: catalogue rows of their own, marked repairOnly (see below).
  ...REPAIR_SERVICES.map((s) => ({
    labelFa: s.nameFa,
    labelEn: s.nameEn,
    canonicalFa: s.nameFa,
    membersFa: [s.nameFa],
  })),
];

/** Canonical Persian name -> the label column 37 should print for a REPAIRED part. */
export const REPAIR_LABEL_BY_CANONICAL_FA = new Map(
  REPAIR_PICKER_GROUPS.map((g) => [g.canonicalFa, g.labelFa]),
);

/**
 * Narrow a full catalogue down to the repaired-in-place shortlist, relabelled.
 *
 * Returns one entry per button in REPAIR_PICKER_GROUPS, carrying the canonical part's
 * id — so a selection still stores against a real catalogue row — under the group's own
 * label. Order follows the group list, not the catalogue's export order, because this
 * list exists to be read quickly rather than to mirror a spreadsheet.
 */
export function repairShortlist<
  T extends { nameFa: string; nameEn: string; sortOrder: number },
>(catalogue: T[]): T[] {
  const byName = new Map(catalogue.map((p) => [p.nameFa, p]));
  const out: T[] = [];
  for (const [i, group] of REPAIR_PICKER_GROUPS.entries()) {
    const part = byName.get(group.canonicalFa);
    // A catalogue missing the canonical part means a seed/catalogue mismatch. Skip the
    // button rather than crash the form a technician is standing in a shop with.
    if (!part) continue;
    out.push({ ...part, nameFa: group.labelFa, nameEn: group.labelEn, sortOrder: i + 1 });
  }
  return out;
}
