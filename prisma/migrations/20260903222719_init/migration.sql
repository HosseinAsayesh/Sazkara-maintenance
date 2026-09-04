-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TECHNICIAN', 'MANAGER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('JTI_EXCEL', 'MANUAL', 'HISTORICAL');

-- CreateEnum
CREATE TYPE "PartAction" AS ENUM ('REPLACED', 'REPAIRED');

-- CreateEnum
CREATE TYPE "RepairOutcome" AS ENUM ('REPAIRED', 'NOT_REPAIRED');

-- CreateEnum
CREATE TYPE "NotRepairedReason" AS ENUM ('MANAGER_NOT_AUTHORIZED', 'STORE_OR_STAND_REMOVED', 'ALREADY_HEALTHY', 'STORE_TEMPORARILY_CLOSED', 'CONDITION_TOO_POOR');

-- CreateEnum
CREATE TYPE "PhotoType" AS ENUM ('STORE', 'BEFORE', 'AFTER', 'OTHER');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('CONFIRMED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderLineStatus" AS ENUM ('PENDING', 'DONE', 'EXCLUDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'TECHNICIAN',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "technicianCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "isTehran" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "digitalAddress" TEXT,
    "managerName" TEXT,
    "phone" TEXT,
    "cityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "matchKey" TEXT NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stand" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "storeId" TEXT,
    "standIndexAtStore" INTEGER NOT NULL DEFAULT 1,
    "confirmation" "ConfirmationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT NOT NULL,
    "fileRef" TEXT,
    "columnMapping" JSONB,
    "mappingProfileId" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnMappingProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColumnMappingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "standId" TEXT,
    "storeName" TEXT,
    "address" TEXT,
    "digitalAddress" TEXT,
    "managerName" TEXT,
    "phone" TEXT,
    "cityName" TEXT,
    "status" "OrderLineStatus" NOT NULL DEFAULT 'PENDING',
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateNote" TEXT,
    "duplicateOfFormId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartCatalogItem" (
    "id" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "exportColumnKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PartCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairForm" (
    "id" TEXT NOT NULL,
    "formCode" TEXT NOT NULL,
    "standId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "cityId" TEXT,
    "storeId" TEXT,
    "storeName" TEXT,
    "storeAddress" TEXT,
    "storeManagerName" TEXT,
    "storePhone" TEXT,
    "digitalAddress" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "timeSpentMinutes" INTEGER,
    "qualityScore" INTEGER,
    "notes" TEXT,
    "technicianSignature" TEXT,
    "storeManagerSignature" TEXT,
    "outcome" "RepairOutcome" NOT NULL,
    "notRepairedReason" "NotRepairedReason",
    "isReRepair" BOOLEAN NOT NULL DEFAULT false,
    "previousFormId" TEXT,
    "isUnmatched" BOOLEAN NOT NULL DEFAULT false,
    "wageAmount" DECIMAL(14,2),
    "wageTier" INTEGER NOT NULL DEFAULT 1,
    "wageRateApplied" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartUsage" (
    "id" TEXT NOT NULL,
    "repairFormId" TEXT NOT NULL,
    "partCatalogItemId" TEXT NOT NULL,
    "action" "PartAction" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PartUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "repairFormId" TEXT NOT NULL,
    "type" "PhotoType" NOT NULL,
    "fileRef" TEXT NOT NULL,
    "index" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WageSetting" (
    "key" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WageSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EvidencePdfBatch" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "fileRef" TEXT NOT NULL,
    "standCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,

    CONSTRAINT "EvidencePdfBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_technicianCode_key" ON "User"("technicianCode");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "City_name_key" ON "City"("name");

-- CreateIndex
CREATE INDEX "Store_cityId_idx" ON "Store"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_cityId_matchKey_key" ON "Store"("cityId", "matchKey");

-- CreateIndex
CREATE UNIQUE INDEX "Stand_uid_key" ON "Stand"("uid");

-- CreateIndex
CREATE INDEX "Stand_storeId_idx" ON "Stand"("storeId");

-- CreateIndex
CREATE INDEX "Stand_confirmation_idx" ON "Stand"("confirmation");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMappingProfile_name_key" ON "ColumnMappingProfile"("name");

-- CreateIndex
CREATE INDEX "ColumnMappingProfile_signature_idx" ON "ColumnMappingProfile"("signature");

-- CreateIndex
CREATE INDEX "OrderLine_uid_idx" ON "OrderLine"("uid");

-- CreateIndex
CREATE INDEX "OrderLine_status_idx" ON "OrderLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_batchId_uid_key" ON "OrderLine"("batchId", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "PartCatalogItem_nameFa_key" ON "PartCatalogItem"("nameFa");

-- CreateIndex
CREATE UNIQUE INDEX "PartCatalogItem_exportColumnKey_key" ON "PartCatalogItem"("exportColumnKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartCatalogItem_sortOrder_key" ON "PartCatalogItem"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RepairForm_formCode_key" ON "RepairForm"("formCode");

-- CreateIndex
CREATE INDEX "RepairForm_date_idx" ON "RepairForm"("date");

-- CreateIndex
CREATE INDEX "RepairForm_cityId_date_idx" ON "RepairForm"("cityId", "date");

-- CreateIndex
CREATE INDEX "RepairForm_technicianId_date_idx" ON "RepairForm"("technicianId", "date");

-- CreateIndex
CREATE INDEX "RepairForm_standId_date_idx" ON "RepairForm"("standId", "date");

-- CreateIndex
CREATE INDEX "RepairForm_outcome_idx" ON "RepairForm"("outcome");

-- CreateIndex
CREATE INDEX "PartUsage_partCatalogItemId_action_idx" ON "PartUsage"("partCatalogItemId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "PartUsage_repairFormId_partCatalogItemId_action_key" ON "PartUsage"("repairFormId", "partCatalogItemId", "action");

-- CreateIndex
CREATE INDEX "Photo_repairFormId_index_idx" ON "Photo"("repairFormId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "EvidencePdfBatch_cityId_date_key" ON "EvidencePdfBatch"("cityId", "date");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stand" ADD CONSTRAINT "Stand_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stand" ADD CONSTRAINT "Stand_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_mappingProfileId_fkey" FOREIGN KEY ("mappingProfileId") REFERENCES "ColumnMappingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_standId_fkey" FOREIGN KEY ("standId") REFERENCES "Stand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_standId_fkey" FOREIGN KEY ("standId") REFERENCES "Stand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairForm" ADD CONSTRAINT "RepairForm_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartUsage" ADD CONSTRAINT "PartUsage_repairFormId_fkey" FOREIGN KEY ("repairFormId") REFERENCES "RepairForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartUsage" ADD CONSTRAINT "PartUsage_partCatalogItemId_fkey" FOREIGN KEY ("partCatalogItemId") REFERENCES "PartCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_repairFormId_fkey" FOREIGN KEY ("repairFormId") REFERENCES "RepairForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePdfBatch" ADD CONSTRAINT "EvidencePdfBatch_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePdfBatch" ADD CONSTRAINT "EvidencePdfBatch_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
