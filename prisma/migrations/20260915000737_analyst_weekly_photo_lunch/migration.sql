-- AlterTable
ALTER TABLE "analysts" ADD COLUMN     "lunchEndMinutes" INTEGER,
ADD COLUMN     "lunchStartMinutes" INTEGER,
ADD COLUMN     "photo" TEXT,
ADD COLUMN     "weeklyCapacityMinutes" INTEGER[] DEFAULT ARRAY[0, 480, 480, 480, 480, 480, 0]::INTEGER[];

-- Data migration: preenche weeklyCapacityMinutes a partir de dailyCapacityMinutes + workDays existentes
UPDATE "analysts"
SET "weeklyCapacityMinutes" = ARRAY[
  CASE WHEN 0 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END,
  CASE WHEN 1 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END,
  CASE WHEN 2 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END,
  CASE WHEN 3 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END,
  CASE WHEN 4 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END,
  CASE WHEN 5 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END,
  CASE WHEN 6 = ANY("workDays") THEN "dailyCapacityMinutes" ELSE 0 END
];
