-- The Jti uid identifies a STORE (a location), not an individual stand.
-- One uid can carry several stands ("double stands"), so:
--   * Store.uid becomes the unique key,
--   * Stand loses its uid and is identified by (storeId, standIndexAtStore),
--   * RepairForm snapshots the uid and the stand position it covers,
--   * OrderLine points at the store rather than a stand.
--
-- Existing rows are migrated, not dropped. Where two stands currently share one store
-- but carry different uids, the store is cloned so each uid keeps its own location
-- record — that is lossless, and the alternative would silently merge two Jti locations.

-- 1. New columns, nullable while they are backfilled.
ALTER TABLE "Store" ADD COLUMN "uid" TEXT;
ALTER TABLE "RepairForm" ADD COLUMN "uid" TEXT;
ALTER TABLE "RepairForm" ADD COLUMN "standIndex" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderLine" ADD COLUMN "storeId" TEXT;

-- 2. Give every stand a store carrying its uid.
DO $$
DECLARE
  s          RECORD;
  target_id  TEXT;
  fallback   TEXT;
BEGIN
  SELECT id INTO fallback FROM "City" ORDER BY "createdAt" LIMIT 1;

  FOR s IN SELECT * FROM "Stand" ORDER BY "createdAt" LOOP
    target_id := NULL;

    -- A store already claimed this uid (e.g. a second stand processed earlier).
    SELECT id INTO target_id FROM "Store" WHERE "uid" = s."uid";

    IF target_id IS NULL AND s."storeId" IS NOT NULL THEN
      -- Adopt the stand's current store if it has not claimed a uid yet.
      SELECT id INTO target_id FROM "Store" WHERE id = s."storeId" AND "uid" IS NULL;

      IF target_id IS NOT NULL THEN
        UPDATE "Store" SET "uid" = s."uid" WHERE id = target_id;
      ELSE
        -- The store is already spoken for by a different uid: clone it so this uid
        -- keeps its own location record.
        target_id := gen_random_uuid()::TEXT;
        INSERT INTO "Store" (id, "uid", name, address, "digitalAddress", "managerName",
                             phone, "cityId", "matchKey", "createdAt", "updatedAt")
        SELECT target_id, s."uid", name, address, "digitalAddress", "managerName",
               phone, "cityId", "matchKey" || '-' || s."uid", NOW(), NOW()
        FROM "Store" WHERE id = s."storeId";
      END IF;
    END IF;

    IF target_id IS NULL THEN
      -- Stand with no store at all: synthesise a minimal location for its uid.
      target_id := gen_random_uuid()::TEXT;
      INSERT INTO "Store" (id, "uid", name, "cityId", "matchKey", "createdAt", "updatedAt")
      VALUES (target_id, s."uid", s."uid", fallback, s."uid", NOW(), NOW());
    END IF;

    UPDATE "Stand" SET "storeId" = target_id WHERE id = s.id;
  END LOOP;
END $$;

-- 3. Renumber stands per store so (storeId, standIndexAtStore) is unique.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "storeId" ORDER BY "createdAt", id) AS n
  FROM "Stand"
)
UPDATE "Stand" SET "standIndexAtStore" = ranked.n
FROM ranked WHERE "Stand".id = ranked.id;

-- 4. Backfill the RepairForm snapshots from the stand they were filed against.
UPDATE "RepairForm" f
SET "uid" = st."uid", "standIndex" = s."standIndexAtStore"
FROM "Stand" s JOIN "Store" st ON st.id = s."storeId"
WHERE f."standId" = s.id;

-- 5. Point order lines at the store that owns their uid.
UPDATE "OrderLine" ol SET "storeId" = st.id FROM "Store" st WHERE st."uid" = ol."uid";

-- 6. Drop the old stand-level uid and its dependants.
ALTER TABLE "OrderLine" DROP CONSTRAINT IF EXISTS "OrderLine_standId_fkey";
DROP INDEX IF EXISTS "Stand_uid_key";
ALTER TABLE "OrderLine" DROP COLUMN "standId";
ALTER TABLE "Stand" DROP COLUMN "uid";

-- 7. Tighten the new columns now that they are populated.
DELETE FROM "Store" WHERE "uid" IS NULL AND id NOT IN (SELECT DISTINCT "storeId" FROM "Stand");
UPDATE "Store" SET "uid" = 'LEGACY-' || id WHERE "uid" IS NULL;
ALTER TABLE "Store" ALTER COLUMN "uid" SET NOT NULL;

DELETE FROM "RepairForm" WHERE "uid" IS NULL;
ALTER TABLE "RepairForm" ALTER COLUMN "uid" SET NOT NULL;

ALTER TABLE "Stand" ALTER COLUMN "storeId" SET NOT NULL;

-- 8. Constraints and indexes for the new shape.
DROP INDEX IF EXISTS "Store_cityId_matchKey_key";
CREATE UNIQUE INDEX "Store_uid_key" ON "Store"("uid");
CREATE INDEX "Store_matchKey_idx" ON "Store"("matchKey");
CREATE UNIQUE INDEX "Stand_storeId_standIndexAtStore_key"
  ON "Stand"("storeId", "standIndexAtStore");
CREATE INDEX "RepairForm_uid_date_idx" ON "RepairForm"("uid", "date");
CREATE INDEX "OrderLine_storeId_idx" ON "OrderLine"("storeId");

ALTER TABLE "Stand" DROP CONSTRAINT IF EXISTS "Stand_storeId_fkey";
ALTER TABLE "Stand" ADD CONSTRAINT "Stand_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"(id) ON DELETE SET NULL ON UPDATE CASCADE;
