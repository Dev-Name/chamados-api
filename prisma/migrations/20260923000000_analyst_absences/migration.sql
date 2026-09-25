-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('FERIAS', 'FOLGA', 'ATESTADO', 'OUTRO');

-- AlterTable: transforma a tabela de férias em tabela de ausências/licenças
ALTER TABLE "analyst_vacations" RENAME TO "analyst_absences";
ALTER TABLE "analyst_absences" RENAME COLUMN "data_inicio" TO "data_hora_inicio";
ALTER TABLE "analyst_absences" RENAME COLUMN "data_fim" TO "data_hora_fim";
ALTER TABLE "analyst_absences" RENAME CONSTRAINT "analyst_vacations_pkey" TO "analyst_absences_pkey";
ALTER TABLE "analyst_absences" RENAME CONSTRAINT "analyst_vacations_analystId_fkey" TO "analyst_absences_analystId_fkey";

-- Novos campos; registros pre-existentes viram FERIAS de dia inteiro
ALTER TABLE "analyst_absences" ADD COLUMN "tipo" "AbsenceType" NOT NULL DEFAULT 'FERIAS';
ALTER TABLE "analyst_absences" ADD COLUMN "dia_inteiro" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "analyst_absences" ADD COLUMN "descricao" TEXT;

-- O antigo data_fim era meia-noite do ultimo dia; passa a cobrir o dia inteiro
-- (fim do dia). data_hora_inicio permanece a meia-noite do primeiro dia.
UPDATE "analyst_absences"
SET "data_hora_fim" = "data_hora_fim" + INTERVAL '1 day' - INTERVAL '1 millisecond';

-- Renomeia o indice para acompanhar a nova coluna
ALTER INDEX "analyst_vacations_analystId_data_inicio_data_fim_idx" RENAME TO "analyst_absences_analystId_data_hora_inicio_data_hora_fim_idx";