-- AlterTable: categoria ganha cor (badge/pill) e flag de ativação (soft-delete)
ALTER TABLE "categories" ADD COLUMN "cor" TEXT;
ALTER TABLE "categories" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: cor padrão em rodízio da paleta para as categorias já existentes
UPDATE "categories"
SET "cor" = (ARRAY['#4f46e5','#0d9488','#f59e0b','#dc2626','#7c3aed','#0284c7','#db2777','#65a30d'])[1 + ("id" % 8)]
WHERE "cor" IS NULL;

-- AlterTable: cor agora é obrigatória
ALTER TABLE "categories" ALTER COLUMN "cor" SET NOT NULL;