-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'LEAD_TECHNICIAN';

-- DropIndex
DROP INDEX "OrderLine_storeId_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "leadId" TEXT;

-- CreateIndex
CREATE INDEX "User_leadId_idx" ON "User"("leadId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
