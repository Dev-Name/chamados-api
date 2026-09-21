import type { ViewId } from "./state";
import { DAY_MS, emit, store } from "./state";
import { cap, fmtDay, longDay, longMonth, mondayOf, startOf } from "./format";

export function periodDays(): Date[] {
  const v = store.view;
  const ref = startOf(store.refDate);
  if (v === "day") return [ref];
  const ws = mondayOf(ref);
  if (v === "week") {
    const d: Date[] = [];
    for (let i = 0; i < 7; i++) d.push(new Date(ws.getTime() + i * DAY_MS));
    return d;
  }
  if (v === "month") {
    const d: Date[] = [];
    const st = new Date(ref.getFullYear(), ref.getMonth(), 1);
    while (st.getMonth() === ref.getMonth()) {
      d.push(new Date(st));
      st.setDate(st.getDate() + 1);
    }
    return d;
  }
  if (v === "year") {
    const d: Date[] = [];
    const st = new Date(ref.getFullYear(), 0, 1);
    const y = ref.getFullYear();
    while (st.getFullYear() === y) {
      d.push(new Date(st));
      st.setDate(st.getDate() + 1);
    }
    return d;
  }
  const d: Date[] = [];
  for (let i = 0; i < 7; i++) d.push(new Date(ws.getTime() + i * DAY_MS));
  return d;
}

export function ganttHorizonDays(): number {
  const d = startOf(store.refDate);
  if (store.ganttScale === "day") return 1;
  if (store.ganttScale === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return 7;
}

export function ganttWindowStart(): Date {
  const d = startOf(store.refDate);
  if (store.ganttScale === "day") return d;
  if (store.ganttScale === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return mondayOf(d);
}

function weekLabelFrom(ws: Date): string {
  const end = new Date(ws.getTime() + 6 * DAY_MS);
  if (ws.getMonth() === end.getMonth()) {
    const mn = cap(end.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
    return `${ws.getDate()} a ${end.getDate()} de ${mn}`;
  }
  return `${fmtDay(ws)} a ${fmtDay(end)} de ${end.getFullYear()}`;
}

export function periodLabel(): string {
  const d = startOf(store.refDate);
  const v = store.view;
  if (v === "day") {
    const month = cap(d.toLocaleDateString("pt-BR", { month: "long" }));
    return `${d.getDate()} de ${month} de ${d.getFullYear()}`;
  }
  const ws = mondayOf(d);
  if (v === "week" || v === "load") return weekLabelFrom(ws);
  if (v === "month") return longMonth(d);
  if (v === "year") return "Ano de " + d.getFullYear();
  if (v === "gantt") {
    const gs = ganttWindowStart();
    if (store.ganttScale === "day") return longDay(gs);
    if (store.ganttScale === "month") return longMonth(gs);
    return weekLabelFrom(gs);
  }
  return "Quadro de trabalho";
}

export function go(dir: number): void {
  const d = startOf(store.refDate);
  const v = store.view;
  if (v === "day") store.refDate = new Date(d.getTime() + dir * DAY_MS);
  else if (v === "week") store.refDate = new Date(d.getTime() + dir * 7 * DAY_MS);
  else if (v === "month") store.refDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  else if (v === "year") store.refDate = new Date(d.getFullYear() + dir, 0, 1);
  else if (v === "gantt") {
    if (store.ganttScale === "day") store.refDate = new Date(d.getTime() + dir * DAY_MS);
    else if (store.ganttScale === "month") store.refDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
    else store.refDate = new Date(d.getTime() + dir * 7 * DAY_MS);
  }
  else if (v === "load") store.refDate = new Date(d.getTime() + dir * 7 * DAY_MS);
  else return;
  emit();
}

export function setView(v: ViewId): void {
  store.view = v;
  store.selected.clear();
  emit();
}