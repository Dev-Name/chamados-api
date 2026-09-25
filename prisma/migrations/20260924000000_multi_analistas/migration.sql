-- AlterTable
ALTER TABLE "analyst_absences" ALTER COLUMN "tipo" DROP DEFAULT;

-- CreateTable
CREATE TABLE "_TicketAssignees" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_TicketAssignees_AB_unique" ON "_TicketAssignees"("A", "B");

-- CreateIndex
CREATE INDEX "_TicketAssignees_B_index" ON "_TicketAssignees"("B");

-- AddForeignKey
ALTER TABLE "_TicketAssignees" ADD CONSTRAINT "_TicketAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "analysts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TicketAssignees" ADD CONSTRAINT "_TicketAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada chamado com responsável entra na fila do próprio responsável
INSERT INTO "_TicketAssignees" ("A", "B")
SELECT "analystId", "id" FROM "tickets" WHERE "analystId" IS NOT NULL;