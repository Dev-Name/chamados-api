import type { Analyst, Ticket } from "./state";
import { basePriColor, catPalette, statusColor, store, DAY_MS } from "./state";
import { lunchForDow, capFor, startForDow, prodCapOfDow } from "./analysts";
import { minOfDay, startOf, sameDay } from "./format";

export function categoryColor(id: number): string {
  if (store.prefs.catColors && store.prefs.catColors[id]) return store.prefs.catColors[id];
  return catPalette[id % catPalette.length];
}

export function priorityColor(p: number): string {
  const pri = Math.min(Math.max(p || 5, 1), 5);
  return basePriColor[pri];
}

export function blockColor(t: Ticket): string {
  const p = Math.min(Math.max(t.priority || 5, 1), 5);
  if (store.prefs.colorBy === "priority") return basePriColor[p];
  if (store.prefs.colorBy === "status") return statusColor[t.status] || "#94a3b8";
  return categoryColor(t.category.id);
}

export function stColor(t: Ticket): string {
  return statusColor[t.status] || "#94a3b8";
}

export function isOverdue(t: Ticket): boolean {
  return t.status !== "COMPLETED" && !!t.dueDate && new Date(t.dueDate).getTime() < Date.now();
}

export function remainOf(t: Ticket): number {
  return Math.max(t.estimatedMinutes - (t.workedMinutes || 0), 0);
}

export function pctDone(t: Ticket): number {
  return Math.round((t.workedMinutes / Math.max(t.estimatedMinutes, 1)) * 100);
}

export interface Segment {
  date: Date;
  from: number;
  to: number;
}

export function segmentsOf(t: Ticket, a?: Analyst | null): Segment[] {
  if (!t.startDate || !t.dueDate) return [];
  const start = new Date(t.startDate);
  const due = new Date(t.dueDate);
  const segs: Segment[] = [];
  let cur = startOf(start);
  while (cur <= due) {
    const dow = cur.getDay();
    // Pula dias sem expediente quando o analista está disponível
    if (a && capFor(a, cur) <= 0) {
      cur = new Date(cur.getTime() + DAY_MS);
      continue;
    }
    const isStart = sameDay(cur, start);
    const isEnd = sameDay(cur, due);
    const from = isStart ? minOfDay(start) : (a ? startForDow(a, dow) : 0);
    const to = isEnd ? minOfDay(due) : 24 * 60;
    if (to > from) {
      const lunch = a ? lunchForDow(a, dow) : null;
      if (lunch && lunch.start < to && lunch.end > from) {
        if (from < lunch.start) segs.push({ date: new Date(cur), from, to: Math.min(to, lunch.start) });
        if (lunch.end < to) segs.push({ date: new Date(cur), from: Math.max(from, lunch.end), to });
      } else {
        segs.push({ date: new Date(cur), from, to });
      }
    }
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return segs;
}

// Cache de segmentsOf por render — chave "ticketId", limpo a cada emissão de store.
let _segCache: Map<number, Segment[]> | null = null;

/** Versão com cache de segmentsOf. Deve ser usada dentro de um ciclo de render. */
export function segmentsOfCached(t: Ticket, a?: Analyst | null): Segment[] {
  if (!_segCache) _segCache = new Map();
  const hit = _segCache.get(t.id);
  if (hit) return hit;
  const segs = segmentsOf(t, a);
  _segCache.set(t.id, segs);
  return segs;
}

export function usedMinInDay(a: Analyst, date: Date): number {
  const cap = capFor(a, date);
  if (cap <= 0) return 0;
  const s0 = date.getTime() + startForDow(a, date.getDay()) * 60000;
  const s1 = s0 + cap * 60000;
  const prod = prodCapOfDow(a, date.getDay());
  let used = 0;
  for (const t of a.tickets) {
    if (t.status === "COMPLETED") continue;
    for (const seg of segmentsOfCached(t, a)) {
      const ss = seg.date.getTime() + seg.from * 60000;
      const se = seg.date.getTime() + seg.to * 60000;
      const ov = Math.min(se, s1) - Math.max(ss, s0);
      if (ov > 0) used += ov / 60000;
    }
  }
  return Math.min(used, prod);
}

// Cache de usedMinInDay por render — chave "analystId:dateISO", limpo a cada emissão de store.
let _usedCache: Map<string, number> | null = null;

/** Versão com cache de usedMinInDay. Usar dentro de um único ciclo de render. */
export function usedMinInDayCached(a: Analyst, date: Date): number {
  if (!_usedCache) _usedCache = new Map();
  const key = `${a.id}:${date.toISOString().slice(0, 10)}`;
  if (_usedCache.has(key)) return _usedCache.get(key)!;
  const v = usedMinInDay(a, date);
  _usedCache.set(key, v);
  return v;
}

/** Limpa os caches de usedMinInDay e segmentsOf. Deve ser chamado ao início de cada render. */
export function clearUsedCache(): void {
  _usedCache = null;
  _segCache = null;
}

export function allTickets(): Ticket[] {
  const out: Ticket[] = [];
  for (const a of store.analysts) out.push(...a.tickets);
  return out;
}

export function sortedQueue(a: Analyst): Ticket[] {
  return a.tickets
    .filter((t) => t.status !== "COMPLETED")
    .sort((x, y) => x.priority - y.priority || x.position - y.position || x.id - y.id);
}