-- AlterTable: almoço por dia da semana (7 valores 0=Dom..6=Sáb), espelhando weeklyCapacityMinutes.
-- null dentro do array = sem intervalo naquele dia. null no campo = usa o par legado abaixo.
-- Default [] = mesmo "semântico null" do schema (7x null). Backfill: espalha o par legado nos 7 dias.
ALTER TABLE "analysts"
  ADD COLUMN "weeklyLunchStartMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "weeklyLunchEndMinutes"   INTEGER[] DEFAULT ARRAY[]::INTEGER[];
