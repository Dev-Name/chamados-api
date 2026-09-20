import type { Analyst, Filters, Ticket } from "./state";
import { statusLabel, store } from "./state";
import { getCleanName } from "./format";

export const DEFAULT_FILTERS: Filters = { analyst: "", category: "0", status: "", priority: "", q: "" };

function isAll(v: string, zeroIsAll = false): boolean {
  if (v === "" || v === "ALL") return true;
  if (zeroIsAll && v === "0") return true;
  return false;
}

export function visibleAnalysts(): Analyst[] {
  if (isAll(store.filters.analyst)) return store.analysts;
  const sel = Number(store.filters.analyst);
  return Number.isFinite(sel) ? store.analysts.filter((a) => a.id === sel) : store.analysts;
}

export function visibleTicket(t: Ticket): boolean {
  if (store.filters.status && !isAll(store.filters.status) && t.status !== store.filters.status) return false;
  if (store.filters.priority && !isAll(store.filters.priority) && t.priority !== Number(store.filters.priority)) return false;
  if (store.filters.category && !isAll(store.filters.category, true) && Number(store.filters.category) !== t.category.id) return false;
  if (store.filters.q) {
    const q = store.filters.q.toLowerCase();
    if (!`#${t.id} ${t.title}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

export function fillFilterSelects(): void {
  const opts: Record<string, Array<string[]>> = {
    "f-analyst": [["", "Todos os analistas"], ...store.analysts.map((a) => [String(a.id), getCleanName(a.name)])],
    "f-category": [["0", "Todas as categorias"], ...store.categories.map((c) => [String(c.id), c.name])],
    "f-status": [["", "Todos os status"], ...Object.entries(statusLabel)],
    "f-priority": [["", "Todas as prioridades"], ...[1, 2, 3, 4, 5].map((p) => [String(p), "P" + p])],
  };
  const keyMap: Record<string, "analyst" | "category" | "status" | "priority"> = {
    "f-analyst": "analyst",
    "f-category": "category",
    "f-status": "status",
    "f-priority": "priority",
  };
  for (const id of Object.keys(opts)) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) continue;
    const prev = store.filters[keyMap[id]];
    sel.innerHTML = "";
    for (const [v, label] of opts[id]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = opts[id].some(([v]) => String(v) === String(prev)) ? String(prev) : opts[id][0][0];
  }
}

export function categoriesFromTickets(): Array<{ id: number; name: string }> {
  const map = new Map<number, { id: number; name: string }>();
  for (const a of store.analysts) for (const t of a.tickets) map.set(t.category.id, t.category);
  return [...map.values()];
}