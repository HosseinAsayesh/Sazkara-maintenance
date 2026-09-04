-- CreateEnum
CREATE TYPE "PartUnit" AS ENUM ('PIECE', 'CENTIMETER');

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "phaseId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "PartCatalogItem" ADD COLUMN     "quantityStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unit" "PartUnit" NOT NULL DEFAULT 'PIECE';

-- AlterTable
ALTER TABLE "RepairForm" ADD COLUMN     "hasPreviousProjectHistory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isQuickReRepair" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phaseId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Phase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE INDEX "Project_isActive_idx" ON "Project"("isActive");

-- CreateIndex
CREATE INDEX "Phase_projectId_sortOrder_idx" ON "Phase"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Phase_projectId_name_key" ON "Phase"("projectId", "name");

-- CreateIndex
CREATE INDEX "RepairForm_projectId_date_idx" ON "RepairForm"("projectId", "date");

-- CreateIndex
CREATE INDEX "RepairForm_phaseId_idx" ON "RepairForm"("phaseId");

-- CreateIndex
CREATE INDEX "RepairForm_standId_projectId_outcome_idx" ON "RepairForm"("standId", "projectId", "outcome");

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
