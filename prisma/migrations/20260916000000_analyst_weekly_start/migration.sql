-- AlterTable: início do expediente por dia da semana (7 valores 0=Dom..6=Sáb),
-- em minutos desde a meia-noite (ex.: 540 = 09:00), espelhando weeklyCapacityMinutes.
-- -1 dentro do array = sem expediente naquele dia. [] = não configurado (motor assume 09:00).
ALTER TABLE "analysts"
  ADD COLUMN "weeklyStartMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
