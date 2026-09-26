import { PrismaClient, TicketStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.analyst.findFirst();
  if (existing) {
    console.log("Já existem dados, seed ignorado.");
    return;
  }

  const ana = await prisma.analyst.create({
    data: { name: "Ana Ribeiro", dailyCapacityMinutes: 480, weeklyCapacityMinutes: [0, 480, 480, 480, 480, 480, 0], lunchStartMinutes: 720, lunchEndMinutes: 780, workDays: [1, 2, 3, 4, 5] },
  });
  const bob = await prisma.analyst.create({
    data: { name: "Bob Martins", dailyCapacityMinutes: 360, weeklyCapacityMinutes: [0, 360, 360, 360, 360, 360, 360], workDays: [1, 2, 3, 4, 5, 6] },
  });

  const cat = await prisma.category.create({ data: { name: "Infraestrutura", cor: "#0284c7" } });
  const cat2 = await prisma.category.create({ data: { name: "Sistemas", cor: "#7c3aed" } });

  const t1 = await prisma.ticket.create({
    data: {
      title: "Migrar servidor de aplicação",
      categoryId: cat.id,
      analystId: ana.id,
      estimatedMinutes: 900,
      priority: 1,
      position: 1,
      status: TicketStatus.IN_PROGRESS,
    },
  });

  const t2 = await prisma.ticket.create({
    data: {
      title: "Atualizar certificado SSL do portal",
      categoryId: cat.id,
      analystId: ana.id,
      estimatedMinutes: 240,
      priority: 2,
      position: 2,
      dependsOnTicketId: t1.id,
    },
  });

  await prisma.ticket.create({
    data: {
      title: "Ajuste de permissões em rede",
      categoryId: cat.id,
      analystId: ana.id,
      estimatedMinutes: 480,
      priority: 5,
      position: 3,
    },
  });

  const relatorio = await prisma.ticket.create({
    data: {
      title: "Criar relatório de vendas",
      categoryId: cat2.id,
      analystId: bob.id,
      estimatedMinutes: 720,
      priority: 1,
      position: 1,
    },
  });

  await prisma.ticket.create({
    data: {
      title: "Homologação do relatório",
      categoryId: cat2.id,
      analystId: bob.id,
      estimatedMinutes: 120,
      priority: 2,
      position: 2,
      dependsOnTicketId: relatorio.id,
    },
  });

  console.log(`Seed criado: analistas ${ana.name} e ${bob.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());