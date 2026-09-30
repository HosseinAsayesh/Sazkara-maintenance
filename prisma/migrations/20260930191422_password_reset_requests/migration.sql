-- CreateEnum
CREATE TYPE "PasswordResetStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PasswordResetStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetRequest_status_idx" ON "PasswordResetRequest"("status");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_userId_status_idx" ON "PasswordResetRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
