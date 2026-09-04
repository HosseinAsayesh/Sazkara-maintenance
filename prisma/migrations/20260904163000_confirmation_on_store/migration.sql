-- §6.2 tracks whether a uid was admitted to the official record. Now that the uid
-- identifies a store, the flag belongs on the store rather than on each of its stands.
ALTER TABLE "Store" ADD COLUMN "confirmation" "ConfirmationStatus" NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "Store" ADD COLUMN "createdById" TEXT;

-- A location is pending if any stand under it was: the stands were the only carrier of
-- the flag until now, so this preserves every outstanding manager decision.
UPDATE "Store" st SET "confirmation" = 'PENDING'
WHERE EXISTS (SELECT 1 FROM "Stand" s WHERE s."storeId" = st.id AND s."confirmation" = 'PENDING');
UPDATE "Store" st SET "confirmation" = 'REJECTED'
WHERE "confirmation" = 'CONFIRMED'
  AND EXISTS (SELECT 1 FROM "Stand" s WHERE s."storeId" = st.id AND s."confirmation" = 'REJECTED');

UPDATE "Store" st SET "createdById" = s."createdById"
FROM "Stand" s WHERE s."storeId" = st.id AND s."createdById" IS NOT NULL;

ALTER TABLE "Stand" DROP CONSTRAINT IF EXISTS "Stand_createdById_fkey";
DROP INDEX IF EXISTS "Stand_confirmation_idx";
ALTER TABLE "Stand" DROP COLUMN "confirmation";
ALTER TABLE "Stand" DROP COLUMN "createdById";

CREATE INDEX "Store_confirmation_idx" ON "Store"("confirmation");
ALTER TABLE "Store" ADD CONSTRAINT "Store_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
