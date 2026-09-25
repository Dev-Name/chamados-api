import { Router } from "express";
import { AbsenceType } from "@prisma/client";
import { prisma, AnalystNotFoundError } from "../lib/errors";
import { parseId } from "../lib/http";
import { recalculateAnalystQueue, ACTIVE_STATUSES } from "../services/ticket.service";
import { analystWithQueueDTO } from "../lib/ticket-dto";
import { fmtBrazilDateTime, fmtLocalDate } from "../lib/availability";

const ABSENCE_TYPES = Object.values(AbsenceType);
const MAX_DESCRICAO = 300;

export const analystsRouter = Router();

const WEEK = [0, 1, 2, 3, 4, 5, 6];
const MAX_NAME = 120;

/**
 * Aceita uma data no formato "AAAA-MM-DD" (ou ISO completo) e retorna
 * um Date @ meia-noite UTC (date-only). Tri-estado:
 * - undefined: campo ausente (não alterar)
 * - null / "": limpar o campo
 * - Date: valor válido a persistir
 */
function parseDateValue(value: unknown): { error?: string; date?: Date | null } {
  if (value === undefined) return {};
  if (value === null || value === "") return { date: null };
  if (typeof value !== "string") return { error: "Data inválida (use AAAA-MM-DD)" };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value.trim());
  if (!m) return { error: "Data inválida (use AAAA-MM-DD)" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { error: "Data inválida (use AAAA-MM-DD)" };
  }
  return { date: d };
}

/**
 * Valida um array por dia da semana com 7 elementos onde cada um é
 * null/undefined/"" (sem valor) ou inteiro 0..1439. Valores vazios viram -1.
 * Retorna undefined se o payload estiver ausente; null se o formato for inválido.
 * Usado para início/fim de almoço e início de expediente por dia.
 */
function admittedWeeklyMinutes(value: unknown): number[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 7) return null;
  const out: number[] = [];
  for (const v of value) {
    if (v === null || v === undefined || v === "") { out.push(-1); continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 1439) return null;
    out.push(n);
  }
  return out; // -1 = sem valor naquele dia
}

/** Valida par a par: quando um dia tem início e fim, exige end > start. */
function validateWeeklyLunch(
  start: number[] | null | undefined,
  end: number[] | null | undefined
): string | null {
  if (start === undefined && end === undefined) return null;
  if (start === null || end === null || start === undefined || end === undefined) {
    return "weeklyLunchStartMinutes e weeklyLunchEndMinutes devem vir juntos (7 valores cada)";
  }
  for (let d = 0; d < 7; d++) {
    const s = start[d] >= 0 ? start[d] : null;
    const e = end[d] >= 0 ? end[d] : null;
    if (s == null && e == null) continue;
    if (s == null || e == null) return "Dia " + dowLabel(d) + ": informe início e fim do almoço (ou deixe ambos vazios)";
    if (e <= s) return "Dia " + dowLabel(d) + ": o fim do almoço deve ser depois do início";
  }
  return null;
}
function dowLabel(d: number): string {
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d];
}

/** 7 valores (0=Dom..6=Sáb) de minutos >= 0; retorna undefined se inválido/ausente. */
function admittedWeekly(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== 7) return undefined;
  const mins = value.map((v) => Number(v));
  if (!mins.every((m) => Number.isInteger(m) && m >= 0 && m <= 1440)) return undefined;
  if (!mins.some((m) => m > 0)) return undefined;
  return mins;
}

/** minutos desde a meia-noite (0..1439) com tri-estado: undefined=ausente, null=limpar */
function admittedMinutes(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1439) return undefined;
  return n;
}

/** validar par de almoço: quando houver um lado, ambos precisam existir e end > start */
function validateLunch(start: number | null | undefined, end: number | null | undefined): string | null {
  if (start == null && end == null) return null;
  if (start == null || end == null) return "Informe o início e o fim do almoço (ou deixe ambos vazios)";
  if (end <= start) return "O fim do almoço deve ser depois do início";
  return null;
}

function admittedPhoto(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.exec(value);
  if (!m) return undefined;
  const base64 = value.slice(value.indexOf(",") + 1);
  if (base64.length > 3_500_000) return undefined; // ~2.6MB de imagem
  return value;
}

function admittedWorkDays(workDays: unknown): number[] | undefined {
  if (!Array.isArray(workDays)) return undefined;
  const set = new Set(
    workDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  );
  if (set.size === 0) return undefined;
  return [...set].sort();
}

function admittedCapacity(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** A partir de weeklyCapacityMinutes (7) ou do par legado, deriva os campos a persistir. */
function scheduleFields(
  body: Record<string, unknown>
): { weeklyCapacityMinutes: number[]; workDays: number[]; dailyCapacityMinutes: number } | undefined {
  const weekly = admittedWeekly(body.weeklyCapacityMinutes);
  if (weekly) {
    const workDays = WEEK.filter((d) => weekly[d] > 0);
    return {
      weeklyCapacityMinutes: weekly,
      workDays,
      dailyCapacityMinutes: Math.max(...weekly),
    };
  }
  const capacity = admittedCapacity(body.dailyCapacityMinutes);
  const workDays = admittedWorkDays(body.workDays);
  if (capacity && workDays) {
    return {
      weeklyCapacityMinutes: WEEK.map((d) => (workDays.includes(d) ? capacity : 0)),
      workDays,
      dailyCapacityMinutes: capacity,
    };
  }
  return undefined;
}

async function recalcAnalysts(ids: Array<number | null | undefined>) {
  const unique = [...new Set(ids.filter((id) => id != null) as number[])];
  for (const id of unique) {
    await recalculateAnalystQueue(id);
  }
}

type LunchFields = {
  lunchStartMinutes?: number | null;
  lunchEndMinutes?: number | null;
  weeklyLunchStartMinutes?: number[];
  weeklyLunchEndMinutes?: number[];
  weeklyStartMinutes?: number[];
};

/**
 * Valida e extrai os campos de almoço e início de expediente de um body.
 * Retorna `{ error }` se inválido, ou `{ fields }` com os campos prontos para persistir.
 */
function parseLunchFields(body: Record<string, unknown>): { error: string } | { fields: LunchFields } {
  const fields: LunchFields = {};

  // Par legado de almoço (único horário para todos os dias)
  const lunchStart = admittedMinutes(body.lunchStartMinutes);
  const lunchEnd = admittedMinutes(body.lunchEndMinutes);
  const lunchErr = validateLunch(lunchStart, lunchEnd);
  if (lunchErr) return { error: lunchErr };
  if (lunchStart !== undefined) fields.lunchStartMinutes = lunchStart;
  if (lunchEnd !== undefined) fields.lunchEndMinutes = lunchEnd;

  // Arrays semanais de almoço
  const weeklyLs = admittedWeeklyMinutes(body.weeklyLunchStartMinutes);
  const weeklyLe = admittedWeeklyMinutes(body.weeklyLunchEndMinutes);
  if (weeklyLs === null)
    return { error: "weeklyLunchStartMinutes deve ter 7 valores (0=Dom..6=Sáb), cada um 0..1439 ou vazio para sem almoço" };
  if (weeklyLe === null)
    return { error: "weeklyLunchEndMinutes deve ter 7 valores (0=Dom..6=Sáb), cada um 0..1439 ou vazio para sem almoço" };
  if ((weeklyLs === undefined) !== (weeklyLe === undefined))
    return { error: "weeklyLunchStartMinutes e weeklyLunchEndMinutes devem vir juntos (7 valores cada)" };
  if (weeklyLs !== undefined && weeklyLe !== undefined) {
    const weeklyErr = validateWeeklyLunch(weeklyLs, weeklyLe);
    if (weeklyErr) return { error: weeklyErr };
    fields.weeklyLunchStartMinutes = weeklyLs;
    fields.weeklyLunchEndMinutes = weeklyLe;
  }

  // Início de expediente por dia
  const weeklyStart = admittedWeeklyMinutes(body.weeklyStartMinutes);
  if (weeklyStart === null)
    return { error: "weeklyStartMinutes deve ter 7 valores (0=Dom..6=Sáb), cada um 0..1439 ou vazio para sem expediente" };
  if (weeklyStart !== undefined) fields.weeklyStartMinutes = weeklyStart;

  return { fields };
}

analystsRouter.get("/", async (_req, res, next) => {
  try {
    const analysts = await prisma.analyst.findMany({
      orderBy: { id: "asc" },
      include: {
        absences: { orderBy: [{ data_hora_inicio: "asc" }, { id: "asc" }] },
        _count: { select: { assignedTickets: { where: { status: { in: ACTIVE_STATUSES } } } } },
      },
    });
    res.json(analysts);
  } catch (error) {
    next(error);
  }
});

/**
 * Retorna todos os analistas com suas filas de tickets embutidas em uma única query,
 * eliminando o N+1 que ocorria ao chamar GET /analysts + GET /analysts/:id/queue para cada um.
 */
analystsRouter.get("/with-queues", async (_req, res, next) => {
  try {
    const analysts = await prisma.analyst.findMany({
      orderBy: { id: "asc" },
      include: {
        absences: { orderBy: [{ data_hora_inicio: "asc" }, { id: "asc" }] },
        assignedTickets: {
          orderBy: [{ priority: "asc" }, { position: "asc" }, { id: "asc" }],
          include: { dependsOn: true, category: true, assignees: { select: { id: true } } },
        },
      },
    });
    res.json(analysts.map((a) => analystWithQueueDTO({ ...a, tickets: a.assignedTickets })));
  } catch (error) {
    next(error);
  }
});

analystsRouter.get("/:id/queue", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    const analyst = await prisma.analyst.findUnique({
      where: { id: analystId },
      include: {
        absences: { orderBy: [{ data_hora_inicio: "asc" }, { id: "asc" }] },
        assignedTickets: {
          orderBy: [{ priority: "asc" }, { position: "asc" }, { id: "asc" }],
          include: { dependsOn: true, category: true, assignees: { select: { id: true } } },
        },
      },
    });
    if (!analyst) {
      res.status(404).json({ error: "Analista não encontrado" });
      return;
    }
    res.json(analystWithQueueDTO({ ...analyst, tickets: analyst.assignedTickets }));
  } catch (error) {
    next(error);
  }
});

analystsRouter.post("/", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Informe o nome do analista" });
      return;
    }
    if (name.length > MAX_NAME) {
      res.status(400).json({ error: `O nome deve ter no máximo ${MAX_NAME} caracteres` });
      return;
    }
    const schedule = scheduleFields(req.body ?? {});
    if (!schedule) {
      res.status(400).json({
        error: "Informe weeklyCapacityMinutes ([Dom..Sáb] em minutos, ao menos um dia > 0) ou dailyCapacityMinutes + workDays",
      });
      return;
    }
    const lunchResult = parseLunchFields(req.body ?? {});
    if ("error" in lunchResult) { res.status(400).json({ error: lunchResult.error }); return; }
    const lunchFields = lunchResult.fields;

    let photo: string | null = null;
    if (req.body.photo !== undefined) {
      const accepted = admittedPhoto(req.body.photo);
      if (accepted === undefined) {
        res.status(400).json({ error: "Formato de foto inválido (use PNG/JPEG/WebP/GIF)" });
        return;
      }
      photo = accepted;
    }
    const desligamento = parseDateValue(req.body.data_desligamento);
    if (desligamento.error) { res.status(400).json({ error: desligamento.error }); return; }
    const analyst = await prisma.analyst.create({
      data: {
        name,
        ...schedule,
        ...lunchFields,
        photo,
        data_desligamento: desligamento.date === undefined ? null : desligamento.date,
      },
    });
    res.status(201).json(analyst);
  } catch (error) {
    next(error);
  }
});

analystsRouter.patch("/:id", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    if (!(await prisma.analyst.findUnique({ where: { id: analystId } }))) {
      throw new AnalystNotFoundError(analystId);
    }

    const data: {
      name?: string;
      weeklyCapacityMinutes?: number[];
      workDays?: number[];
      dailyCapacityMinutes?: number;
      lunchStartMinutes?: number | null;
      lunchEndMinutes?: number | null;
      weeklyLunchStartMinutes?: number[];
      weeklyLunchEndMinutes?: number[];
      weeklyStartMinutes?: number[];
      photo?: string | null;
      data_desligamento?: Date | null;
    } = {};
    if (typeof req.body.name === "string" && req.body.name.trim()) {
      if (req.body.name.trim().length > MAX_NAME) {
        res.status(400).json({ error: `O nome deve ter no máximo ${MAX_NAME} caracteres` });
        return;
      }
      data.name = req.body.name.trim();
    }

    const body = req.body ?? {};
    const schedule = scheduleFields(body);
    if (schedule) Object.assign(data, schedule);

    const lunchResult = parseLunchFields(body);
    if ("error" in lunchResult) { res.status(400).json({ error: lunchResult.error }); return; }
    Object.assign(data, lunchResult.fields);

    if (body.photo !== undefined) {
      const photo = admittedPhoto(body.photo);
      if (photo === undefined) {
        res.status(400).json({ error: "Formato de foto inválido (use PNG/JPEG/WebP/GIF)" });
        return;
      }
      data.photo = photo;
    }

    const desligamento = parseDateValue(body.data_desligamento);
    if (desligamento.error) { res.status(400).json({ error: desligamento.error }); return; }
    if (desligamento.date !== undefined) data.data_desligamento = desligamento.date;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "Nada para atualizar" });
      return;
    }

    const analyst = await prisma.analyst.update({ where: { id: analystId }, data });
    await recalcAnalysts([analystId]);
    res.json(analyst);
  } catch (error) {
    next(error);
  }
});

analystsRouter.get("/:id/absences", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    if (!(await prisma.analyst.findUnique({ where: { id: analystId } }))) {
      throw new AnalystNotFoundError(analystId);
    }
    const absences = await prisma.analystAbsence.findMany({
      where: { analystId },
      orderBy: [{ data_hora_inicio: "asc" }, { id: "asc" }],
    });
    res.json(absences);
  } catch (error) {
    next(error);
  }
});

/** Aceita uma data/hora ISO (ex.: "2026-09-25T14:00:00") e retorna um Date válido. */
function parseAbsenceDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `dia_inteiro` aceito como boolean (ou "true"/"false"/1/0); padrão true. */
function parseAbsenceDayBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * Valida e extrai o payload de uma ausência/licença vindo do body.
 * Regras: tipo obrigatório; fim estritamente maior que início; descrição opcional.
 */
function parseAbsencePayload(
  body: Record<string, unknown>
):
  | { error: string }
  | {
      fields: {
        tipo: AbsenceType;
        dia_inteiro: boolean;
        data_hora_inicio: Date;
        data_hora_fim: Date;
        descricao: string | null;
      };
    } {
  const tipoRaw = body.tipo;
  if (typeof tipoRaw !== "string" || !ABSENCE_TYPES.includes(tipoRaw as AbsenceType)) {
    return { error: "tipo inválido (use FERIAS, FOLGA, ATESTADO ou OUTRO)" };
  }
  const diaInteiro = body.dia_inteiro === undefined ? true : parseAbsenceDayBoolean(body.dia_inteiro);
  const inicio = parseAbsenceDateTime(body.data_hora_inicio);
  if (!inicio) {
    return { error: "data_hora_inicio inválida (use uma data/hora ISO, ex.: 2026-09-25T14:00:00)" };
  }
  const fim = parseAbsenceDateTime(body.data_hora_fim);
  if (!fim) {
    return { error: "data_hora_fim inválida (use uma data/hora ISO, ex.: 2026-09-25T16:30:00)" };
  }
  if (fim.getTime() <= inicio.getTime()) {
    return { error: "data_hora_fim deve ser estritamente maior que data_hora_inicio" };
  }
  let descricao: string | null = null;
  if (body.descricao !== undefined && body.descricao !== null && body.descricao !== "") {
    if (typeof body.descricao !== "string") return { error: "descricao inválida" };
    const trimmed = body.descricao.trim();
    if (trimmed.length > MAX_DESCRICAO) {
      return { error: `descricao deve ter no máximo ${MAX_DESCRICAO} caracteres` };
    }
    descricao = trimmed;
  }
  return {
    fields: {
      tipo: tipoRaw as AbsenceType,
      dia_inteiro: diaInteiro,
      data_hora_inicio: inicio,
      data_hora_fim: fim,
      descricao,
    },
  };
}

/**
 * Monta a resposta de sobreposição: mensagem amigável + período estruturado
 * (`conflict`) para o front destacar os registros conflitantes na lista.
 * Para "dia inteiro" exibe só as datas; para parcial, datas e horas.
 */
function overlapResponse(overlap: {
  dia_inteiro: boolean;
  data_hora_inicio: Date;
  data_hora_fim: Date;
}): { error: string; conflict: { data_hora_inicio: Date; data_hora_fim: Date } } {
  const error = overlap.dia_inteiro
    ? `Já existe uma ausência ou férias cadastrada entre ${fmtLocalDate(overlap.data_hora_inicio)} e ${fmtLocalDate(overlap.data_hora_fim)}`
    : `Já existe uma ausência ou férias cadastrada entre ${fmtBrazilDateTime(overlap.data_hora_inicio)} e ${fmtBrazilDateTime(overlap.data_hora_fim)}`;
  return {
    error,
    conflict: { data_hora_inicio: overlap.data_hora_inicio, data_hora_fim: overlap.data_hora_fim },
  };
}

analystsRouter.post("/:id/absences", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    if (!(await prisma.analyst.findUnique({ where: { id: analystId } }))) {
      throw new AnalystNotFoundError(analystId);
    }
    const parsed = parseAbsencePayload(req.body ?? {});
    if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }

    const overlap = await prisma.analystAbsence.findFirst({
      where: {
        analystId,
        data_hora_inicio: { lt: parsed.fields.data_hora_fim },
        data_hora_fim: { gt: parsed.fields.data_hora_inicio },
      },
    });
    if (overlap) {
      res.status(409).json(overlapResponse(overlap));
      return;
    }

    const absence = await prisma.analystAbsence.create({
      data: { analystId, ...parsed.fields },
    });
    res.status(201).json(absence);
  } catch (error) {
    next(error);
  }
});

analystsRouter.patch("/:id/absences/:absenceId", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    const absenceId = parseId(req.params.absenceId);
    if (!analystId || !absenceId) { res.status(400).json({ error: "ID inválido" }); return; }
    const existing = await prisma.analystAbsence.findUnique({ where: { id: absenceId } });
    if (!existing || existing.analystId !== analystId) {
      res.status(404).json({ error: "Ausência não encontrada" });
      return;
    }
    const parsed = parseAbsencePayload(req.body ?? {});
    if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }

    const overlap = await prisma.analystAbsence.findFirst({
      where: {
        analystId,
        id: { not: absenceId },
        data_hora_inicio: { lt: parsed.fields.data_hora_fim },
        data_hora_fim: { gt: parsed.fields.data_hora_inicio },
      },
    });
    if (overlap) {
      res.status(409).json(overlapResponse(overlap));
      return;
    }

    const absence = await prisma.analystAbsence.update({
      where: { id: absenceId },
      data: parsed.fields,
    });
    res.json(absence);
  } catch (error) {
    next(error);
  }
});

analystsRouter.delete("/:id/absences/:absenceId", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    const absenceId = parseId(req.params.absenceId);
    if (!analystId || !absenceId) { res.status(400).json({ error: "ID inválido" }); return; }
    const existing = await prisma.analystAbsence.findUnique({ where: { id: absenceId } });
    if (!existing || existing.analystId !== analystId) {
      res.status(404).json({ error: "Ausência não encontrada" });
      return;
    }
    await prisma.analystAbsence.delete({ where: { id: absenceId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

analystsRouter.delete("/:id", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    const existing = await prisma.analyst.findUnique({ where: { id: analystId } });
    if (!existing) { res.status(404).json({ error: "Analista não encontrado" }); return; }
    const affected = await prisma.ticket.findMany({
      where: { OR: [{ analystId }, { assignees: { some: { id: analystId } } }] },
      select: { assignees: { select: { id: true } } },
    });
    await prisma.ticket.updateMany({ where: { analystId }, data: { analystId: null } });
    // As linhas de `_TicketAssignees` do analista são removidas em cascata
    await prisma.analyst.delete({ where: { id: analystId } });
    const remaining = new Set<number>();
    for (const t of affected) {
      for (const a of t.assignees) if (a.id !== analystId) remaining.add(a.id);
    }
    await recalcAnalysts([...remaining]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

analystsRouter.post("/:id/recalculate", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    const result = await recalculateAnalystQueue(analystId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

analystsRouter.post("/:id/reorder", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    if (!(await prisma.analyst.findUnique({ where: { id: analystId } }))) {
      throw new AnalystNotFoundError(analystId);
    }
    const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
    if (order.length === 0 || order.some((id: number) => !Number.isInteger(id) || id <= 0)) {
      res.status(400).json({ error: "order deve ser uma lista de ids de chamados" });
      return;
    }
    if (new Set(order).size !== order.length) {
      res.status(400).json({ error: "order não pode ter ids repetidos" });
      return;
    }
    const tickets = await prisma.ticket.findMany({
      where: { id: { in: order } },
      select: { id: true, assignees: { select: { id: true } } },
    });
    if (tickets.length !== order.length) {
      res.status(400).json({ error: "Um ou mais chamados da ordem não existem" });
      return;
    }
    // A ordem só pode incluir chamados que tenham este analista na fila (m2m)
    if (tickets.some((t) => !t.assignees.some((a) => a.id === analystId))) {
      res.status(400).json({ error: "A ordem só pode incluir chamados deste analista" });
      return;
    }
    await prisma.$transaction(
      order.map((ticketId: number, position: number) =>
        prisma.ticket.update({ where: { id: ticketId }, data: { position } })
      )
    );
    const result = await recalculateAnalystQueue(analystId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});