import dayjs, { Dayjs } from "dayjs";
import { Analyst, Prisma, TicketStatus } from "@prisma/client";
import { prisma, CycleDependencyError, AnalystNotFoundError } from "../lib/errors";
import { AnalystCalendar } from "../lib/calendar";

type ActiveTicket = Prisma.TicketGetPayload<{ include: { dependsOn: true } }>;

export interface RecalcResult {
  analystId: number;
  scheduled: number;
  unschedulable: Array<{ id: number; reason: string }>;
  cycleDetected: boolean;
}

export const ACTIVE_STATUSES = [TicketStatus.BACKLOG, TicketStatus.IN_PROGRESS, TicketStatus.PAUSED];

/**
 * Motor de recálculo de prazos da fila de um analista.
 *
 * 1. Busca os tickets ativos do analista ordenados por prioridade (ASC) e posição (ASC);
 * 2. Ordena topologicamente respeitando dependências técnicas (B só inicia depois de A);
 * 3. Simula a jornada útil (dias úteis + expediente em minutos, pulando o almoço),
 *    transbordando o saldo de horas excedentes para o próximo dia útil;
 * 4. Persiste startDate e dueDate recalculados de cada ticket afetado.
 */
export async function recalculateAnalystQueue(analystId: number): Promise<RecalcResult> {
  const analyst: Analyst | null = await prisma.analyst.findUnique({ where: { id: analystId } });
  if (!analyst) {
    throw new AnalystNotFoundError(analystId);
  }

  const active = await prisma.ticket.findMany({
    where: { analystId, status: { in: ACTIVE_STATUSES } },
    orderBy: [{ priority: "asc" }, { position: "asc" }, { id: "asc" }],
    include: { dependsOn: true },
  });

  if (active.length === 0) {
    return { analystId, scheduled: 0, unschedulable: [], cycleDetected: false };
  }

  const activeById = new Map<number, ActiveTicket>(active.map((t) => [t.id, t]));
  const dependents = new Map<number, number[]>();
  const inDegree = new Map<number, number>();

  for (const ticket of active) {
    inDegree.set(ticket.id, 0);
    const dep = ticket.dependsOn;
    if (dep && activeById.has(dep.id)) {
      inDegree.set(ticket.id, (inDegree.get(ticket.id) ?? 0) + 1);
      dependents.set(dep.id, [...(dependents.get(dep.id) ?? []), ticket.id]);
    }
  }

  const ordered = topoSort(active, activeById, dependents, inDegree);
  if (ordered.length < active.length) {
    const leftover = new Set(active.map((t) => t.id));
    for (const t of ordered) leftover.delete(t.id);
    throw new CycleDependencyError(extractCycle([...leftover], activeById, dependents));
  }

  const calendar = new AnalystCalendar([], 0, undefined, {
    capacityByDay: analyst.weeklyCapacityMinutes,
    startByDay: analyst.weeklyStartMinutes,
    lunchStartByDay: analyst.weeklyLunchStartMinutes,
    lunchEndByDay: analyst.weeklyLunchEndMinutes,
    lunchStartMinutes: analyst.lunchStartMinutes,
    lunchEndMinutes: analyst.lunchEndMinutes,
  });
  const scheduledDue = new Map<number, Dayjs>();
  const unschedulable: RecalcResult["unschedulable"] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];

  for (const ticket of ordered) {
    const dep = ticket.dependsOn;
    let depDue: Dayjs | null = null;

    if (dep) {
      const resolvedDue = scheduledDue.get(dep.id);
      if (resolvedDue) {
        depDue = resolvedDue;
      } else if (dep.dueDate) {
        depDue = dayjs(dep.dueDate);
      } else {
        unschedulable.push({
          id: ticket.id,
          reason: `depende do chamado #${dep.id}, que ainda não possui dueDate calculado`,
        });
        continue;
      }
    }

    const earliest = calendar.nextAvailableAt();
    const preserveStart =
      ticket.status !== TicketStatus.BACKLOG && ticket.startDate ? dayjs(ticket.startDate) : null;
    const start = maxDay(earliest, depDue, preserveStart);

    calendar.alignTo(start);
    const remaining = Math.max(ticket.estimatedMinutes - ticket.workedMinutes, 0);
    const due = remaining > 0 ? calendar.allocate(remaining) : start;

    scheduledDue.set(ticket.id, due);
    updates.push(
      prisma.ticket.update({
        where: { id: ticket.id },
        data: { startDate: start.toDate(), dueDate: due.toDate() },
      })
    );
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return { analystId, scheduled: ordered.length - unschedulable.length, unschedulable, cycleDetected: false };
}

export async function recalculateAllQueues(): Promise<RecalcResult[]> {
  const analysts = await prisma.analyst.findMany({ select: { id: true } });
  return Promise.all(analysts.map(({ id }) => recalculateAnalystQueue(id)));
}

/**
 * Ordenação topológica estável (Kahn): a cada passo, entre os tickets "prontos"
 * (sem dependências ativas pendentes), escolhe o primeiro na ordenação
 * prioridade ASC / posição ASC mantida em `sorted`.
 */
function topoSort(
  sorted: ActiveTicket[],
  activeById: Map<number, ActiveTicket>,
  dependents: Map<number, number[]>,
  inDegree: Map<number, number>
): ActiveTicket[] {
  const pendingDegree = new Map(inDegree);
  const ready = new Set<number>();

  for (const ticket of sorted) {
    if ((pendingDegree.get(ticket.id) ?? 0) === 0) ready.add(ticket.id);
  }

  const result: ActiveTicket[] = [];
  while (ready.size > 0) {
    let nextId: number | undefined;
    for (const ticket of sorted) {
      if (ready.has(ticket.id)) {
        nextId = ticket.id;
        break;
      }
    }
    if (nextId === undefined) break;

    ready.delete(nextId);
    const ticket = activeById.get(nextId);
    if (!ticket) break;
    result.push(ticket);

    for (const childId of dependents.get(nextId) ?? []) {
      const degree = (pendingDegree.get(childId) ?? 0) - 1;
      pendingDegree.set(childId, degree);
      if (degree === 0) ready.add(childId);
    }
  }

  return result;
}

function extractCycle(
  remainingIds: number[],
  activeById: Map<number, ActiveTicket>,
  dependents: Map<number, number[]>
): number[] {
  const closed = new Set<number>();
  const visiting = new Set<number>();
  const path: number[] = [];

  const dfs = (id: number): number[] | null => {
    if (visiting.has(id)) {
      const from = path.indexOf(id);
      return path.slice(from).concat(id);
    }
    if (closed.has(id)) return null;

    visiting.add(id);
    path.push(id);

    for (const child of dependents.get(id) ?? []) {
      if (!activeById.has(child) || closed.has(child)) continue;
      const cycle = dfs(child);
      if (cycle) return cycle;
    }

    visiting.delete(id);
    path.pop();
    closed.add(id);
    return null;
  };

  for (const id of remainingIds) {
    const cycle = dfs(id);
    if (cycle) return cycle;
  }
  return remainingIds;
}

function maxDay(a: Dayjs, ...rest: Array<Dayjs | null>): Dayjs {
  let best = a;
  for (const candidate of rest) {
    if (candidate && candidate.isAfter(best)) best = candidate;
  }
  return best;
}