-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "manualDates" BOOLEAN NOT NULL DEFAULT false;