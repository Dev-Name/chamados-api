import { Router } from "express";
import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../lib/errors";
import { parseId } from "../lib/http";
import { recalculateAnalystQueue } from "../services/ticket.service";
import { isTerminated } from "../lib/availability";
import { ticketDTO } from "../lib/ticket-dto";

export const ticketsRouter = Router();

export const TICKET_STATUSES = Object.values(TicketStatus);

const MAX_TITLE = 300;

/** Converte um valor para Date válido (aceita ISO "YYYY-MM-DDTHH:mm:ss" ou "YYYY-MM-DD"). */
function normDate(value: unknown, field: string): { error?: string; value?: Date | null } {
  if (value === null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${field} inválido` };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: `${field} inválido` };
  return { value: d };
}

function normTicketInput(body: Record<string, unknown>): {
  error?: string;
  data?: {
    title?: string;
    categoryId?: number;
    analystId?: number | null;
    analystIds?: number[];
    estimatedMinutes?: number;
    workedMinutes?: number;
    priority?: number;
    status?: TicketStatus;
    dependsOnTicketId?: number | null;
    position?: number;
    startDate?: Date | null;
    dueDate?: Date | null;
    completedAt?: Date | null;
    manualDates?: boolean;
  };
} {
  const data: NonNullable<ReturnType<typeof normTicketInput>["data"]> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "title é obrigatório" };
    if (title.length > MAX_TITLE) return { error: `title deve ter no máximo ${MAX_TITLE} caracteres` };
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
  if (body.analystIds !== undefined) {
    if (!Array.isArray(body.analystIds)) return { error: "analystIds deve ser uma lista de ids" };
    const ids = body.analystIds.map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "analystIds inválido" };
    if (new Set(ids).size !== ids.length) return { error: "analystIds não pode ter ids repetidos" };
    data.analystIds = ids;
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
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) return { error: "priority deve ser um inteiro entre 1 e 5" };
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
  for (const key of ["startDate", "dueDate", "completedAt"] as const) {
    if (body[key] !== undefined) {
      const r = normDate(body[key], key);
      if (r.error) return { error: r.error };
      data[key] = r.value ?? null;
    }
  }
  if (body.manualDates !== undefined) {
    if (typeof body.manualDates !== "boolean") return { error: "manualDates inválido" };
    data.manualDates = body.manualDates;
  }
  if (body.position !== undefined) {
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 0) return { error: "position inválida" };
    data.position = position;
  }

  return { data };
}

/** Verifica se as chaves estrangeiras informadas existem antes de persistir. */
async function validateRefs(fields: {
  categoryId?: number;
  analystId?: number | null;
  analystIds?: number[];
  dependsOnTicketId?: number | null;
}): Promise<string | null> {
  if (fields.categoryId != null) {
    const cat = await prisma.category.findUnique({ where: { id: fields.categoryId }, select: { id: true } });
    if (!cat) return "categoryId não existe";
  }
  if (fields.analystId != null) {
    const ana = await prisma.analyst.findUnique({ where: { id: fields.analystId }, select: { id: true } });
    if (!ana) return "analystId não existe";
  }
  if (fields.analystIds && fields.analystIds.length > 0) {
    const found = await prisma.analyst.findMany({ where: { id: { in: fields.analystIds } }, select: { id: true } });
    if (found.length !== fields.analystIds.length) return "Um ou mais analysts não existem";
  }
  if (fields.dependsOnTicketId != null) {
    const dep = await prisma.ticket.findUnique({ where: { id: fields.dependsOnTicketId }, select: { id: true } });
    if (!dep) return "dependsOnTicketId não existe";
  }
  return null;
}

/**
 * Bloqueia novas atribuições a analistas desligados (data_desligamento <= hoje)
 * ou ausentes no instante atual (now dentro de um intervalo de ausência/licença).
 */
async function ensureAnalystAssignable(analystId: number): Promise<string | null> {
  const ana = await prisma.analyst.findUnique({
    where: { id: analystId },
    include: { absences: { select: { data_hora_inicio: true, data_hora_fim: true } } },
  });
  if (!ana) return null;
  if (isTerminated(ana.data_desligamento)) {
    return "Analista desligado não pode receber novos chamados";
  }
  const now = new Date();
  const absent = (ana.absences || []).some(
    (a) => a.data_hora_inicio.getTime() <= now.getTime() && now.getTime() <= a.data_hora_fim.getTime()
  );
  if (absent) {
    return "Analista ausente não pode receber novos chamados no momento";
  }
  return null;
}

ticketsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = normTicketInput(req.body);
    if (parsed.error || !parsed.data) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { analystIds, ...rest } = parsed.data;
    const title = rest.title;
    const categoryId = rest.categoryId;
    const estimatedMinutes = rest.estimatedMinutes;
    if (!title || !categoryId || !estimatedMinutes) {
      res.status(400).json({ error: "title, categoryId e estimatedMinutes são obrigatórios" });
      return;
    }
    const workedOnCreate = rest.workedMinutes ?? 0;
    if (workedOnCreate > estimatedMinutes) {
      res.status(400).json({ error: "workedMinutes não pode ser maior que estimatedMinutes" });
      return;
    }
    const assigneeIds = analystIds ?? [];
    const analystId = assigneeIds[0] ?? null;
    const dependRefErr = await validateRefs({
      categoryId,
      analystId: analystId ?? null,
      analystIds: assigneeIds,
      dependsOnTicketId: rest.dependsOnTicketId ?? null,
    });
    if (dependRefErr) {
      res.status(400).json({ error: dependRefErr });
      return;
    }
    for (const id of assigneeIds) {
      const assignErr = await ensureAnalystAssignable(id);
      if (assignErr) { res.status(400).json({ error: assignErr }); return; }
    }

    const maxPos = analystId
      ? (await prisma.ticket.aggregate({ where: { assignees: { some: { id: analystId } } }, _max: { position: true } }))._max.position
      : 0;
    const position = rest.position ?? (maxPos ?? -1) + 1;
    const status = rest.status ?? TicketStatus.BACKLOG;
    const completedAt =
      rest.completedAt !== undefined
        ? (rest.completedAt ?? null)
        : status === TicketStatus.COMPLETED
          ? new Date()
          : null;

    const ticket = await prisma.ticket.create({
      data: {
        title,
        categoryId,
        estimatedMinutes,
        priority: rest.priority ?? 5,
        status,
        workedMinutes: rest.workedMinutes ?? 0,
        dependsOnTicketId: rest.dependsOnTicketId ?? null,
        analystId: analystId ?? null,
        position,
        startDate: rest.startDate ?? null,
        dueDate: rest.dueDate ?? null,
        manualDates: rest.manualDates ?? false,
        completedAt,
        ...(assigneeIds.length > 0
          ? { assignees: { connect: assigneeIds.map((id) => ({ id })) } }
          : {}),
      },
      include: { assignees: { select: { id: true } } },
    });
    await recalcTicketAffected(ticket.id);
    res.status(201).json(ticketDTO(ticket));
  } catch (error) {
    next(error);
  }
});

ticketsRouter.patch("/:id", async (req, res, next) => {
  try {
    const ticketId = parseId(req.params.id);
    if (!ticketId) { res.status(400).json({ error: "ID inválido" }); return; }
    const previous = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assignees: { select: { id: true } } },
    });
    if (!previous) {
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }
    const previousAssigneeIds = (previous.assignees ?? []).map((a) => a.id);
    const previousAssigneeSet = new Set(previousAssigneeIds);

    const parsed = normTicketInput(req.body);
    if (parsed.error || !parsed.data) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (parsed.data.dependsOnTicketId === ticketId) {
      res.status(400).json({ error: "Um chamado não pode depender dele mesmo" });
      return;
    }

    const newAssigneeIds =
      parsed.data.analystIds !== undefined
        ? parsed.data.analystIds
        : parsed.data.analystId !== undefined
          ? parsed.data.analystId != null
            ? [parsed.data.analystId]
            : []
          : undefined;
    const nextAssigneeIds = newAssigneeIds ?? previousAssigneeIds;
    const nextResponsibleId: number | null =
      parsed.data.analystIds !== undefined
        ? (parsed.data.analystIds[0] ?? null)
        : parsed.data.analystId !== undefined
          ? (parsed.data.analystId ?? null)
          : previous.analystId;

    // Valida workedMinutes <= estimatedMinutes considerando os valores resultantes
    const effectiveEstimated = parsed.data.estimatedMinutes ?? previous.estimatedMinutes;
    const effectiveWorked = parsed.data.workedMinutes ?? previous.workedMinutes;
    if (effectiveWorked > effectiveEstimated) {
      res.status(400).json({ error: "workedMinutes não pode ser maior que estimatedMinutes" });
      return;
    }

    const refErr = await validateRefs({
      categoryId: parsed.data.categoryId ?? previous.categoryId,
      analystId: nextResponsibleId,
      analystIds: newAssigneeIds !== undefined ? nextAssigneeIds : undefined,
      dependsOnTicketId:
        parsed.data.dependsOnTicketId !== undefined ? (parsed.data.dependsOnTicketId ?? null) : previous.dependsOnTicketId,
    });
    if (refErr) {
      res.status(400).json({ error: refErr });
      return;
    }

    // Bloqueia apenas NOVAS atribuições a analistas desligados/ausentes
    for (const id of nextAssigneeIds) {
      if (previousAssigneeSet.has(id)) continue;
      const assignErr = await ensureAnalystAssignable(id);
      if (assignErr) { res.status(400).json({ error: assignErr }); return; }
    }

    // Data de conclusão: preenchida ao marcar como Concluído e limpa ao sair do status
    const nextStatus = parsed.data.status ?? previous.status;
    let completedAt: Date | null | undefined = parsed.data.completedAt;
    if (parsed.data.status !== undefined) {
      if (nextStatus === TicketStatus.COMPLETED && previous.status !== TicketStatus.COMPLETED) {
        completedAt = completedAt ?? new Date();
      } else if (nextStatus !== TicketStatus.COMPLETED && previous.status === TicketStatus.COMPLETED) {
        completedAt = null;
      }
    }

    const { analystIds: _ignored, ...patchData } = parsed.data;
    const update: Prisma.TicketUncheckedUpdateInput = patchData as Prisma.TicketUncheckedUpdateInput;
    if (parsed.data.analystIds !== undefined) update.analystId = nextResponsibleId;
    if (update.completedAt === undefined && completedAt !== undefined) update.completedAt = completedAt;
    if (parsed.data.startDate !== undefined || parsed.data.dueDate !== undefined) update.manualDates = true;
    if (newAssigneeIds !== undefined) {
      update.assignees = { set: newAssigneeIds.map((id) => ({ id })) };
    }

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: update,
      include: { assignees: { select: { id: true } } },
    });

    // Recalcula todos os analistas impactados: antigos, novos e os das dependências
    const idsToRecalc = new Set<number>(previousAssigneeIds);
    for (const id of ticket.assignees.map((a) => a.id)) idsToRecalc.add(id);
    const depId = parsed.data.dependsOnTicketId !== undefined ? parsed.data.dependsOnTicketId : previous.dependsOnTicketId;
    if (depId != null) {
      for (const id of await ticketAssigneeIds(depId)) idsToRecalc.add(id);
    }
    await recalcAnalysts(idsToRecalc);

    res.json(ticketDTO(ticket));
  } catch (error) {
    next(error);
  }
});

ticketsRouter.delete("/:id", async (req, res, next) => {
  try {
    const ticketId = parseId(req.params.id);
    if (!ticketId) { res.status(400).json({ error: "ID inválido" }); return; }

    // Busca o ticket uma única vez — cobre existência e atribuições simultaneamente
    const existing = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { assignees: { select: { id: true } } },
    });
    if (!existing) {
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }

    await prisma.ticket.updateMany({ where: { dependsOnTicketId: ticketId }, data: { dependsOnTicketId: null } });
    // As linhas de `_TicketAssignees` são removidas em cascata pelo banco
    await prisma.ticket.delete({ where: { id: ticketId } });
    await recalcAnalysts(existing.assignees.map((a) => a.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Ids dos analistas atribuídos a um chamado (m2m). */
async function ticketAssigneeIds(ticketId: number): Promise<number[]> {
  const t = await prisma.ticket
    .findUnique({ where: { id: ticketId }, select: { assignees: { select: { id: true } } } })
    .catch(() => null);
  return (t?.assignees ?? []).map((a) => a.id);
}

async function recalcAnalysts(ids: Iterable<number>): Promise<void> {
  for (const id of new Set(ids)) {
    await recalculateAnalystQueue(id);
  }
}

/** Recalcula todos os analistas impactados por um chamado (os atribuídos + os das dependências). */
async function recalcTicketAffected(ticketId: number): Promise<void> {
  const t = await prisma.ticket
    .findUnique({
      where: { id: ticketId },
      select: { assignees: { select: { id: true } }, dependsOnTicketId: true },
    })
    .catch(() => null);
  if (!t) return;
  const ids = new Set<number>((t.assignees ?? []).map((a) => a.id));
  if (t.dependsOnTicketId != null) {
    for (const id of await ticketAssigneeIds(t.dependsOnTicketId)) ids.add(id);
  }
  await recalcAnalysts(ids);
}