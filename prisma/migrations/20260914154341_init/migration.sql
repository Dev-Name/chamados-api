-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('BACKLOG', 'IN_PROGRESS', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "analysts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "dailyCapacityMinutes" INTEGER NOT NULL DEFAULT 480,
    "workDays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "analystId" INTEGER,
    "estimatedMinutes" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" "TicketStatus" NOT NULL DEFAULT 'BACKLOG',
    "dependsOnTicketId" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE INDEX "tickets_analystId_status_priority_position_idx" ON "tickets"("analystId", "status", "priority", "position");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "analysts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_dependsOnTicketId_fkey" FOREIGN KEY ("dependsOnTicketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
