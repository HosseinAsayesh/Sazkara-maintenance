/**
 * Why a visit ended without a repair — the ten reasons of the client's Jti sheet.
 *
 * One list, in the sheet's own column order (columns 44..53 of the export), shared by the
 * technician's form, the manager's editor, the archive importer, the export and the PDF.
 * The Persian label is the sheet's header, verbatim, so an exported file and an imported
 * one speak the same words.
 */

export const NOT_REPAIRED_REASONS = [
  'STAND_HEALTHY',
  'STORE_CHANGED_USE',
  'STORE_CLOSED',
  'REPLACEMENT_REQUESTED',
  'CANNOT_REPAIR_ON_SITE',
  'PERMISSION_DENIED',
  'POOR_CONDITION',
  'WRONG_ADDRESS',
  'STAND_REMOVED',
  'STORE_REMOVED',
] as const;

export type NotRepairedReasonKey = (typeof NOT_REPAIRED_REASONS)[number];

export interface ReasonInfo {
  /** The sheet's column header, verbatim. */
  labelFa: string;
  /**
   * Header spellings an archive may use, matched after normalising spaces and Persian
   * letter forms. Any header CONTAINING one of these is this reason's column — old files
   * were hand-edited, and an exact-match rule is what silently dropped 12 of Mashhad's 27
   * unsuccessful visits.
   */
  stems: string[];
  /** The sentence the sheet's feedback column carries for such a visit. */
  feedbackFa: string;
  /**
   * The technician never stood in front of the stand (gone, shut, wrong place), so a
   * "before" photo cannot exist and is not asked for.
   */
  standUnreachable: boolean;
}

export const REASON_INFO: Record<NotRepairedReasonKey, ReasonInfo> = {
  STAND_HEALTHY: {
    labelFa: 'استند سالم',
    stems: ['استند سالم'],
    feedbackFa: 'استند سالم میباشد',
    standUnreachable: false,
  },
  STORE_CHANGED_USE: {
    labelFa: 'تغییر کاربری فروشگاه',
    stems: ['تغییر کاربری'],
    feedbackFa: 'فروشگاه تغییر کاربری داده است',
    standUnreachable: true,
  },
  STORE_CLOSED: {
    labelFa: 'تعطیلی فروشگاه',
    stems: ['تعطیل'],
    feedbackFa: 'فروشگاه تعطیل بود',
    standUnreachable: true,
  },
  REPLACEMENT_REQUESTED: {
    labelFa: 'تقاضای تعویض',
    stems: ['تقاضای تعویض'],
    feedbackFa: 'تقاضای تعویض استند را دارند',
    standUnreachable: false,
  },
  CANNOT_REPAIR_ON_SITE: {
    labelFa: 'عدم امکان تعمیر در محل فروشگاه',
    stems: ['عدم امکان تعمیر'],
    feedbackFa: 'امکان تعمیر در محل فروشگاه وجود نداشت',
    standUnreachable: false,
  },
  PERMISSION_DENIED: {
    labelFa: 'عدم صدور اجازه تعمیر',
    stems: ['عدم صدور اجازه', 'اجازه تعمیر'],
    feedbackFa: 'اجازه تعمیر داده نشد',
    standUnreachable: false,
  },
  POOR_CONDITION: {
    labelFa: 'وضعیت نامساعد استند',
    stems: ['وضعیت نامساعد'],
    feedbackFa: 'وضعیت استند نامساعد است',
    standUnreachable: false,
  },
  WRONG_ADDRESS: {
    labelFa: 'آدرس اشتباه',
    stems: ['آدرس اشتباه'],
    feedbackFa: 'آدرس اشتباه بود',
    standUnreachable: true,
  },
  STAND_REMOVED: {
    labelFa: 'استند جمع آوری شده است',
    stems: ['استند جمع آوری', 'استند جمع‌آوری'],
    feedbackFa: 'استند جمع آوری شده است',
    standUnreachable: true,
  },
  STORE_REMOVED: {
    labelFa: 'فروشگاه جمع آوری شده است',
    stems: ['فروشگاه جمع آوری', 'فروشگاه جمع‌آوری'],
    feedbackFa: 'فروشگاه جمع آوری شده است',
    standUnreachable: true,
  },
};

export function isNotRepairedReason(value: unknown): value is NotRepairedReasonKey {
  return typeof value === 'string' && (NOT_REPAIRED_REASONS as readonly string[]).includes(value);
}

/** The sheet header for a stored reason; the raw value if it is not one of the ten. */
export function reasonLabelFa(reason: string | null | undefined): string {
  if (!reason) return '';
  return isNotRepairedReason(reason) ? REASON_INFO[reason].labelFa : reason;
}
