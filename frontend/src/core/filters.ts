import type { Analyst, Filters, Ticket } from "./state";
import { statusLabel, store } from "./state";
import { getCleanName } from "./format";

export const DEFAULT_FILTERS: Filters = { analyst: "", category: "0", status: "", priority: "", q: "" };

export function isAll(v: string, zeroIsAll = false): boolean {
  if (v === "" || v === "ALL") return true;
  if (zeroIsAll && v === "0") return true;
  return false;
}

export function matchesFilters(t: Ticket, f: Filters): boolean {
  if (f.status && !isAll(f.status) && t.status !== f.status) return false;
  if (f.priority && !isAll(f.priority) && t.priority !== Number(f.priority)) return false;
  if (f.category && !isAll(f.category, true) && Number(f.category) !== t.category.id) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`#${t.id} ${t.title}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

export function visibleAnalysts(): Analyst[] {
  if (isAll(store.filters.analyst)) return store.analysts;
  const sel = Number(store.filters.analyst);
  return Number.isFinite(sel) ? store.analysts.filter((a) => a.id === sel) : store.analysts;
}

export function visibleTicket(t: Ticket): boolean {
  return matchesFilters(t, store.filters);
}

export function fillFilterSelects(): void {
  const opts: Record<string, Array<[string, string]>> = {
    "f-analyst": [["", "Todos os analistas"], ...store.analysts.map((a) => [String(a.id), getCleanName(a.name)] as [string, string])],
    "f-category": [["0", "Todas as categorias"], ...store.categories.map((c) => [String(c.id), c.name] as [string, string])],
    "f-status": [["", "Todos os status"], ...Object.entries(statusLabel) as Array<[string, string]>],
    "f-priority": [["", "Todas as prioridades"], ...[1, 2, 3, 4, 5].map((p) => [String(p), "P" + p] as [string, string])],
  };
  const keyMap: Record<string, "analyst" | "category" | "status" | "priority"> = {
    "f-analyst": "analyst",
    "f-category": "category",
    "f-status": "status",
    "f-priority": "priority",
  };
  for (const id of Object.keys(opts)) {
    const prev = store.filters[keyMap[id]];
    fillSelectFromPairs(id, opts[id], prev);
  }
}

/** Preenche um <select> com pares [valor, rótulo], preservando seleção anterior quando possível. */
export function fillSelectFromPairs<K extends string>(
  id: string,
  pairs: Array<[K, string]>,
  prev: string
): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = "";
  for (const [v, label] of pairs) {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = pairs.some(([v]) => String(v) === String(prev)) ? String(prev) : String(pairs[0][0]);
}

export function categoriesFromTickets(): Array<{ id: number; name: string }> {
  const map = new Map<number, { id: number; name: string }>();
  for (const a of store.analysts) for (const t of a.tickets) map.set(t.category.id, t.category);
  return [...map.values()];
}