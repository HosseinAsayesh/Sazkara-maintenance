/**
 * Which photos a visit has to carry.
 *
 * Shared by the form and the server on purpose: if the browser asks for one set and the
 * server insists on another, the technician gets a rejection they cannot act on, standing
 * in a shop. One rule, imported by both.
 *
 * The store photo is a property of the VISIT — it proves the technician went, which is
 * what the wage and the record rest on — so it is always required. Before/after belong to
 * a STAND and describe repair work.
 *
 * §4.4 originally required before AND after on every form. That is wrong whenever nothing
 * was repaired: there is no "after" state to photograph, and the form was demanding a
 * picture that cannot exist. Worse, the two reasons where the technician never reaches
 * the stand — it was removed, or the shop was shut — make a "before" impossible too, so
 * the only way to file a truthful report was to photograph something irrelevant.
 */

export type StandPhoto = 'BEFORE' | 'AFTER';

/**
 * Reasons where the stand itself cannot be photographed: it is gone, or it is behind a
 * closed shutter. The other three (permission refused, stand healthy, condition too poor)
 * all leave a stand standing in front of the technician — and for "condition too poor"
 * the photograph is the whole evidence for the claim, so it stays required.
 */
const STAND_UNREACHABLE = new Set(['STORE_OR_STAND_REMOVED', 'STORE_TEMPORARILY_CLOSED']);

export function requiredStandPhotos(
  outcome: 'REPAIRED' | 'NOT_REPAIRED',
  notRepairedReason?: string | null,
): StandPhoto[] {
  if (outcome === 'REPAIRED') return ['BEFORE', 'AFTER'];
  if (notRepairedReason && STAND_UNREACHABLE.has(notRepairedReason)) return [];
  return ['BEFORE'];
}

/** True when the "after" tile should be shown at all. */
export function needsAfterPhoto(outcome: 'REPAIRED' | 'NOT_REPAIRED'): boolean {
  return outcome === 'REPAIRED';
}
