-- CreateEnum
CREATE TYPE "DownloadKind" AS ENUM ('JTI_EXPORT_MAIN', 'JTI_EXPORT_REREPAIRS', 'PARTS_USAGE_REPORT', 'EVIDENCE_PDF');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'ANSWERED', 'RESOLVED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CLIENT_SUPERVISOR';

-- CreateTable
CREATE TABLE "DownloadRequest" (
    "id" TEXT NOT NULL,
    "kind" "DownloadKind" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "fileRef" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormQuery" (
    "id" TEXT NOT NULL,
    "repairFormId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FormQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormQueryMessage" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormQueryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DownloadRequest_status_createdAt_idx" ON "DownloadRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DownloadRequest_projectId_status_idx" ON "DownloadRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "FormQuery_status_createdAt_idx" ON "FormQuery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FormQuery_repairFormId_idx" ON "FormQuery"("repairFormId");

-- CreateIndex
CREATE INDEX "FormQueryMessage_queryId_createdAt_idx" ON "FormQueryMessage"("queryId", "createdAt");

-- AddForeignKey
ALTER TABLE "DownloadRequest" ADD CONSTRAINT "DownloadRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadRequest" ADD CONSTRAINT "DownloadRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadRequest" ADD CONSTRAINT "DownloadRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormQuery" ADD CONSTRAINT "FormQuery_repairFormId_fkey" FOREIGN KEY ("repairFormId") REFERENCES "RepairForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormQuery" ADD CONSTRAINT "FormQuery_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormQueryMessage" ADD CONSTRAINT "FormQueryMessage_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "FormQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormQueryMessage" ADD CONSTRAINT "FormQueryMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
