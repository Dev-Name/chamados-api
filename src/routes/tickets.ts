import { Router } from "express";
import { TicketStatus } from "@prisma/client";
import { prisma } from "../lib/errors";
import { recalculateAnalystQueue } from "../services/ticket.service";

export const ticketsRouter = Router();

export const TICKET_STATUSES = Object.values(TicketStatus);

function normTicketInput(body: Record<string, unknown>): {
  error?: string;
  data?: {
    title?: string;
    categoryId?: number;
    analystId?: number | null;
    estimatedMinutes?: number;
    workedMinutes?: number;
    priority?: number;
    status?: TicketStatus;
    dependsOnTicketId?: number | null;
    position?: number;
  };
} {
  const data: NonNullable<ReturnType<typeof normTicketInput>["data"]> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "title é obrigatório" };
    data.title = title;
  }
  if (body.categoryId !== undefined) {
    const id = Number(body.categoryId);
    if (!Number.isInteger(id) || id <= 0) return { error: "categoryId inválido" };
    data.categoryId = id;
  }
  if (body.analystId !== undefined) {
    if (body.analystId === null || body.analystId === "") {
      data.analystId = null;
    } else {
      const id = Number(body.analystId);
      if (!Number.isInteger(id) || id <= 0) return { error: "analystId inválido" };
      data.analystId = id;
    }
  }
  if (body.estimatedMinutes !== undefined) {
    const minutes = Number(body.estimatedMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: "estimatedMinutes deve ser maior que zero" };
    data.estimatedMinutes = Math.floor(minutes);
  }
  if (body.workedMinutes !== undefined) {
    const worked = Number(body.workedMinutes);
    if (!Number.isFinite(worked) || worked < 0) return { error: "workedMinutes deve ser >= 0" };
    data.workedMinutes = Math.floor(worked);
  }
  if (body.priority !== undefined) {
    const priority = Number(body.priority);
    if (!Number.isInteger(priority) || priority < 0) return { error: "priority deve ser um inteiro >= 0" };
    data.priority = priority;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !TICKET_STATUSES.includes(body.status as TicketStatus)) {
      return { error: "status inválido" };
    }
    data.status = body.status as TicketStatus;
  }
  if (body.dependsOnTicketId !== undefined) {
    if (body.dependsOnTicketId === null || body.dependsOnTicketId === "") {
      data.dependsOnTicketId = null;
    } else {
      const id = Number(body.dependsOnTicketId);
      if (!Number.isInteger(id) || id <= 0) return { error: "dependsOnTicketId inválido" };
      data.dependsOnTicketId = id;
    }
  }
  if (body.position !== undefined) {
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 0) return { error: "position inválida" };
    data.position = position;
  }

  return { data };
}

async function analystOfTicket(ticketId: number): Promise<number | null> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { analystId: true } });
  return ticket?.analystId ?? null;
}

ticketsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = normTicketInput(req.body);
    if (parsed.error || !parsed.data) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { analystId, ...rest } = parsed.data;
    const title = rest.title;
    const categoryId = rest.categoryId;
    const estimatedMinutes = rest.estimatedMinutes;
    if (!title || !categoryId || !estimatedMinutes) {
      res.status(400).json({ error: "title, categoryId e estimatedMinutes são obrigatórios" });
      return;
    }

    const maxPos = analystId
      ? (await prisma.ticket.aggregate({ where: { analystId }, _max: { position: true } }))._max.position
      : 0;
    const position = rest.position ?? (maxPos ?? -1) + 1;

    const ticket = await prisma.ticket.create({
      data: {
        title,
        categoryId,
        estimatedMinutes,
        priority: rest.priority ?? 5,
        status: rest.status ?? TicketStatus.BACKLOG,
        workedMinutes: rest.workedMinutes ?? 0,
        dependsOnTicketId: rest.dependsOnTicketId ?? null,
        analystId: analystId ?? null,
        position,
      },
    });
    await recalcTicketAffected(analystId ?? null, ticket.dependsOnTicketId);
    res.status(201).json(ticket);
  } catch (error) {
    next(error);
  }
});

ticketsRouter.patch("/:id", async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const previous = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!previous) {
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }

    const parsed = normTicketInput(req.body);
    if (parsed.error || !parsed.data) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (parsed.data.dependsOnTicketId === ticketId) {
      res.status(400).json({ error: "Um chamado não pode depender dele mesmo" });
      return;
    }

    const ticket = await prisma.ticket.update({ where: { id: ticketId }, data: parsed.data });
    await recalcTicketAffected(
      parsed.data.analystId !== undefined ? (parsed.data.analystId ?? null) : previous.analystId,
      parsed.data.dependsOnTicketId !== undefined ? parsed.data.dependsOnTicketId : previous.dependsOnTicketId
    );
    if (parsed.data.analystId !== undefined && parsed.data.analystId !== previous.analystId) {
      if (previous.analystId != null) await recalculateAnalystQueue(previous.analystId);
    }
    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

ticketsRouter.delete("/:id", async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const analystId = await analystOfTicket(ticketId);
    if (analystId == null) {
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ error: "Chamado não encontrado" });
        return;
      }
    }
    await prisma.ticket.updateMany({ where: { dependsOnTicketId: ticketId }, data: { dependsOnTicketId: null } });
    await prisma.ticket.delete({ where: { id: ticketId } });
    if (analystId != null) await recalculateAnalystQueue(analystId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

async function recalcTicketAffected(analystId: number | null, dependsOnTicketId: number | null | undefined) {
  const ids = new Set<number>();
  if (analystId != null) ids.add(analystId);
  if (dependsOnTicketId != null) {
    const analyst = await prisma.ticket
      .findUnique({ where: { id: dependsOnTicketId }, select: { analystId: true } })
      .catch(() => null);
    if (analyst?.analystId != null) ids.add(analyst.analystId);
  }
  for (const id of ids) {
    await recalculateAnalystQueue(id);
  }
}