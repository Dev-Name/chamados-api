import { Router } from "express";
import { prisma, AnalystNotFoundError } from "../lib/errors";
import { recalculateAnalystQueue, ACTIVE_STATUSES } from "../services/ticket.service";

export const analystsRouter = Router();

const WEEK = [0, 1, 2, 3, 4, 5, 6];

/** Converte param de rota para inteiro positivo ou retorna null. */
function parseId(param: string): number | null {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
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
        _count: { select: { tickets: { where: { status: { in: ACTIVE_STATUSES } } } } },
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
        tickets: {
          orderBy: [{ priority: "asc" }, { position: "asc" }, { id: "asc" }],
          include: { dependsOn: true, category: true },
        },
      },
    });
    res.json(analysts);
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
        tickets: {
          orderBy: [{ priority: "asc" }, { position: "asc" }, { id: "asc" }],
          include: { dependsOn: true, category: true },
        },
      },
    });
    if (!analyst) {
      res.status(404).json({ error: "Analista não encontrado" });
      return;
    }
    res.json(analyst);
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
    const analyst = await prisma.analyst.create({
      data: {
        name,
        ...schedule,
        ...lunchFields,
        photo,
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
    } = {};
    if (typeof req.body.name === "string" && req.body.name.trim()) data.name = req.body.name.trim();

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

analystsRouter.delete("/:id", async (req, res, next) => {
  try {
    const analystId = parseId(req.params.id);
    if (!analystId) { res.status(400).json({ error: "ID inválido" }); return; }
    const existing = await prisma.analyst.findUnique({ where: { id: analystId } });
    if (!existing) { res.status(404).json({ error: "Analista não encontrado" }); return; }
    await prisma.ticket.updateMany({ where: { analystId }, data: { analystId: null } });
    await prisma.analyst.delete({ where: { id: analystId } });
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
      select: { id: true, analystId: true },
    });
    if (tickets.length !== order.length) {
      res.status(400).json({ error: "Um ou mais chamados da ordem não existem" });
      return;
    }
    if (tickets.some((t) => t.analystId !== analystId)) {
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