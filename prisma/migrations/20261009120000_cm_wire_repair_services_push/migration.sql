-- Client changes of 2026-10. Additive only: no row is deleted, every quantity and
-- report is kept, and each data step below is a conversion of what is already there.

-- 1. Wires are now measured in centimetres, in 10 cm steps. A recorded "1" was one
--    10 cm piece (client ruling), so existing quantities are multiplied by ten.
UPDATE "PartUsage" SET "quantity" = "quantity" * 10
WHERE "partCatalogItemId" IN (
  SELECT "id" FROM "PartCatalogItem" WHERE "nameFa" IN ('سیم نمره ۱', 'سیم نمره ۰.۵') AND "unit" = 'PIECE'
);
UPDATE "PartCatalogItem" SET "unit" = 'CENTIMETER', "quantityStep" = 10
WHERE "nameFa" IN ('سیم نمره ۱', 'سیم نمره ۰.۵');

-- 2. SMD strips are cut in 30 cm steps (were 50). Recorded centimetres stay as they are.
UPDATE "PartCatalogItem" SET "quantityStep" = 30
WHERE "nameFa" IN ('نوار SMD سفید', 'نوار SMD آبی');

-- 3. Repair work with no part, offered only in the repaired-in-place picker.
ALTER TABLE "PartCatalogItem" ADD COLUMN "repairOnly" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "PartCatalogItem" ("id", "nameFa", "nameEn", "exportColumnKey", "sortOrder", "unit", "quantityStep", "active", "repairOnly") VALUES
  ('svc_power',  'رفع قطعی برق ورودی',   'Restore incoming power', 'svc01', 31, 'PIECE', 1, true, true),
  ('svc_glue',   'چسب کاری قطعات استند', 'Glue stand parts',       'svc02', 32, 'PIECE', 1, true, true),
  ('svc_solder', 'لحیم کاری',            'Soldering',              'svc03', 33, 'PIECE', 1, true, true)
ON CONFLICT DO NOTHING;

-- 4. A return visit to a stand already repaired in the same project is a re-repair
--    whatever it finds, healthy included. Until now only a second REPAIR was flagged,
--    so earlier healthy call-backs are flagged here with the same rule the app applies
--    (lib/projects.ts recomputeReRepairs). Archive rows are never re-repairs themselves.
WITH prev AS (
  SELECT f."id" AS form_id,
    (SELECT p."id" FROM "RepairForm" p
      WHERE p."standId" = f."standId"
        AND p."projectId" = f."projectId"
        AND p."outcome" = 'REPAIRED'
        AND (p."date" < f."date" OR (p."date" = f."date" AND p."createdAt" < f."createdAt"))
      ORDER BY p."date" DESC, p."createdAt" DESC
      LIMIT 1) AS prev_id
  FROM "RepairForm" f
  JOIN "User" u ON u."id" = f."technicianId"
  WHERE f."outcome" = 'NOT_REPAIRED'
    AND f."isReRepair" = false
    AND f."projectId" IS NOT NULL
    AND u."phone" <> '00000000000'
)
UPDATE "RepairForm" f
SET "isReRepair" = true,
    "previousFormId" = p."id",
    "isQuickReRepair" = (f."date" - p."date") <= INTERVAL '14 days'
FROM prev
JOIN "RepairForm" p ON p."id" = prev.prev_id
WHERE f."id" = prev.form_id;

-- 5. Push notifications: one row per browser/phone that agreed to receive them.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. "Order finished" notifications. Orders already finished before this release are
--    marked as announced, so deploying does not send a burst for old work.
ALTER TABLE "ImportBatch" ADD COLUMN "completedNotifiedAt" TIMESTAMP(3);
UPDATE "ImportBatch" b SET "completedNotifiedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "OrderLine" l WHERE l."batchId" = b."id")
  AND NOT EXISTS (SELECT 1 FROM "OrderLine" l WHERE l."batchId" = b."id" AND l."status" = 'PENDING');
