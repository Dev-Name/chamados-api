-- AlterTable
ALTER TABLE "analysts" ADD COLUMN     "data_desligamento" TIMESTAMP(3),
ALTER COLUMN "weeklyLunchStartMinutes" SET DEFAULT ARRAY[]::INTEGER[],
ALTER COLUMN "weeklyLunchEndMinutes" SET DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "analyst_vacations" (
    "id" SERIAL NOT NULL,
    "analystId" INTEGER NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analyst_vacations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analyst_vacations_analystId_data_inicio_data_fim_idx" ON "analyst_vacations"("analystId", "data_inicio", "data_fim");

-- AddForeignKey
ALTER TABLE "analyst_vacations" ADD CONSTRAINT "analyst_vacations_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "analysts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
