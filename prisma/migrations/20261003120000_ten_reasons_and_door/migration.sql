-- The ten unrepaired reasons of the client's Jti sheet replace the original five.
--
-- Existing reports move to the nearest of the ten. Reports imported from archives kept
-- the sheet's own wording at the start of their notes (the importer wrote it there when
-- it had to collapse ten reasons onto five), so those are restored to the exact reason.
CREATE TYPE "NotRepairedReason_new" AS ENUM (
  'STAND_HEALTHY',
  'STORE_CHANGED_USE',
  'STORE_CLOSED',
  'REPLACEMENT_REQUESTED',
  'CANNOT_REPAIR_ON_SITE',
  'PERMISSION_DENIED',
  'POOR_CONDITION',
  'WRONG_ADDRESS',
  'STAND_REMOVED',
  'STORE_REMOVED'
);

ALTER TABLE "RepairForm"
  ALTER COLUMN "notRepairedReason" TYPE "NotRepairedReason_new"
  USING (
    CASE
      WHEN "notRepairedReason" IS NULL THEN NULL
      WHEN "notes" LIKE 'تغییر کاربری%' THEN 'STORE_CHANGED_USE'
      WHEN "notes" LIKE 'آدرس اشتباه%' THEN 'WRONG_ADDRESS'
      WHEN "notes" LIKE 'تقاضای تعویض%' THEN 'REPLACEMENT_REQUESTED'
      WHEN "notes" LIKE 'عدم امکان تعمیر%' THEN 'CANNOT_REPAIR_ON_SITE'
      WHEN "notRepairedReason"::text = 'ALREADY_HEALTHY' THEN 'STAND_HEALTHY'
      WHEN "notRepairedReason"::text = 'STORE_TEMPORARILY_CLOSED' THEN 'STORE_CLOSED'
      WHEN "notRepairedReason"::text = 'MANAGER_NOT_AUTHORIZED' THEN 'PERMISSION_DENIED'
      WHEN "notRepairedReason"::text = 'CONDITION_TOO_POOR' THEN 'POOR_CONDITION'
      WHEN "notRepairedReason"::text = 'STORE_OR_STAND_REMOVED' THEN 'STAND_REMOVED'
    END
  )::"NotRepairedReason_new";

DROP TYPE "NotRepairedReason";
ALTER TYPE "NotRepairedReason_new" RENAME TO "NotRepairedReason";

-- Part 30 (export column 34 / old sheet column 32) is «درب», as the client's sheet says;
-- it had been relabelled «پک هواکش». Same row, so every recorded quantity stays put.
UPDATE "PartCatalogItem"
SET "nameFa" = 'درب', "nameEn" = 'Door'
WHERE "exportColumnKey" = 'col34';
