-- CreateEnum
CREATE TYPE "WeeklyReportSource" AS ENUM ('GENERATED', 'UPLOADED');

-- CreateEnum
CREATE TYPE "WeeklyReportStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DownloadKind" ADD VALUE 'REREPAIR_EVIDENCE_PDF';
ALTER TYPE "DownloadKind" ADD VALUE 'EVIDENCE_PDF_RANGE';

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "projectId" TEXT,
    "source" "WeeklyReportSource" NOT NULL,
    "fileRef" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "note" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "WeeklyReportStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "firstViewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approverName" TEXT,
    "approverSignatureRef" TEXT,
    "approvedById" TEXT,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyReport_status_submittedAt_idx" ON "WeeklyReport"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "WeeklyReport_periodFrom_idx" ON "WeeklyReport"("periodFrom");

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
