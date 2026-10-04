-- Reports remember the order they were filed against, so re-filing the order under
-- another project/phase moves its reports too.
ALTER TABLE "RepairForm" ADD COLUMN "batchId" TEXT;
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "RepairForm_batchId_idx" ON "RepairForm"("batchId");

-- Backfill, historical archives: each imported row belongs to the archive batch that
-- carries its uid and was created most recently before the row itself.
UPDATE "RepairForm" f
SET "batchId" = (
  SELECT b."id"
  FROM "ImportBatch" b
  JOIN "OrderLine" l ON l."batchId" = b."id" AND l."uid" = f."uid"
  WHERE b."source" = 'HISTORICAL' AND b."importedAt" <= f."createdAt"
  ORDER BY b."importedAt" DESC
  LIMIT 1
)
WHERE f."technicianId" IN (SELECT "id" FROM "User" WHERE "phone" = '00000000000');

-- Backfill, technicians' visits: the latest order carrying the uid before the visit,
-- provided it is the one the visit took its project from.
UPDATE "RepairForm" f
SET "batchId" = (
  SELECT b."id"
  FROM "ImportBatch" b
  JOIN "OrderLine" l ON l."batchId" = b."id" AND l."uid" = f."uid"
  WHERE b."importedAt" <= f."createdAt"
    AND b."projectId" IS NOT DISTINCT FROM f."projectId"
    AND b."projectId" IS NOT NULL
  ORDER BY b."importedAt" DESC
  LIMIT 1
)
WHERE f."batchId" IS NULL
  AND f."technicianId" NOT IN (SELECT "id" FROM "User" WHERE "phone" = '00000000000');

-- The bug this fixes: archives re-filed under another project/phase before now left
-- their reports behind. Bring them in line with their order.
UPDATE "RepairForm" f
SET "projectId" = b."projectId", "phaseId" = b."phaseId"
FROM "ImportBatch" b
WHERE f."batchId" = b."id" AND b."source" = 'HISTORICAL'
  AND (f."projectId" IS DISTINCT FROM b."projectId" OR f."phaseId" IS DISTINCT FROM b."phaseId");

-- Weekly reports: one per city and phase, with the evidence PDF beside the Excel.
ALTER TABLE "WeeklyReport" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "WeeklyReport" ADD COLUMN "cityId" TEXT;
ALTER TABLE "WeeklyReport" ADD COLUMN "evidenceFileRef" TEXT;
ALTER TABLE "WeeklyReport" ADD COLUMN "evidenceFileName" TEXT;
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_phaseId_fkey"
  FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
