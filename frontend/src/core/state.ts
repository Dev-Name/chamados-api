export type GridViewId = "day" | "week" | "month" | "year";
export type ViewId = GridViewId | "kanban" | "table" | "load" | "gantt";

export interface Category {
  id: number;
  name: string;
}

export interface Analyst {
  id: number;
  name: string;
  photo: string | null;
  workDays: number[];
  dailyCapacityMinutes: number;
  weeklyCapacityMinutes: number[];
  weeklyStartMinutes: number[];
  lunchStartMinutes: number | null;
  lunchEndMinutes: number | null;
  weeklyLunchStartMinutes: number[];
  weeklyLunchEndMinutes: number[];
  tickets: Ticket[];
}

export interface Ticket {
  id: number;
  title: string;
  categoryId: number;
  category: Category;
  analystId: number | null;
  estimatedMinutes: number;
  workedMinutes: number;
  priority: number;
  status: string;
  dependsOnTicketId: number | null;
  dependsOn?: { id: number } | null;
  position: number;
  startDate: string | null;
  dueDate: string | null;
}

export interface Filters {
  analyst: string;
  category: string;
  status: string;
  priority: string;
  q: string;
}

export type ColorBy = "category" | "priority" | "status";
export type Density = "compact" | "comfort" | "expanded";
export type GanttScale = "day" | "week" | "month";

export interface Prefs {
  colorBy: ColorBy;
  catColors: Record<string, string>;
  density: Density;
  hideWeekends: boolean;
  legend: boolean;
  summary: boolean;
  sideCollapsed: boolean;
}

export const DENSITY_Z: Record<Density, number> = { compact: 0.5, comfort: 0.6, expanded: 1 };

export const SHIFT_START = 9;
export const PPM = 1;
export const DAY_MS = 86400000;

export const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export const DOW_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const WEEK_DOW = [1, 2, 3, 4, 5, 6, 0];

export const statusLabel: Record<string, string> = {
  BACKLOG: "Fila",
  IN_PROGRESS: "Em andamento",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
};

export const STATUS_FLOW: string[] = ["BACKLOG", "IN_PROGRESS", "PAUSED", "COMPLETED"];

export const basePriColor: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#3b82f6",
  4: "#06b6d4",
  5: "#9aa4b2",
};

export const statusColor: Record<string, string> = {
  BACKLOG: "#94a3b8",
  IN_PROGRESS: "#22c55e",
  PAUSED: "#f59e0b",
  COMPLETED: "#6366f1",
};

export const catPalette = [
  "#4f46e5",
  "#0d9488",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0284c7",
  "#db2777",
  "#65a30d",
];

export const analystColors = ["#3b6ef6", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"];

const PREFS_KEY = "calViewPrefs";

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Record<string, unknown>;
    const out: Partial<Prefs> = {};
    if (typeof raw.catColors === "object" && raw.catColors) out.catColors = raw.catColors as Record<string, string>;
    if (raw.colorBy === "category" || raw.colorBy === "priority" || raw.colorBy === "status") out.colorBy = raw.colorBy;
    if (typeof raw.legend === "boolean") out.legend = raw.legend;
    if (typeof raw.summary === "boolean") out.summary = raw.summary;
    if (typeof raw.sideCollapsed === "boolean") out.sideCollapsed = raw.sideCollapsed;
    if (typeof raw.hideWeekends === "boolean") out.hideWeekends = raw.hideWeekends;
    if (raw.density === "compact" || raw.density === "comfort" || raw.density === "expanded") {
      out.density = raw.density;
    } else if (typeof raw.zoom === "number") {
      out.density = raw.zoom >= 1.2 ? "expanded" : raw.zoom <= 0.95 ? "compact" : "comfort";
    }
    return out;
  } catch {
    return {};
  }
}

function todayMonday(): Date {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export interface StoreShape {
  analysts: Analyst[];
  categories: Category[];
  view: ViewId;
  refDate: Date;
  filters: Filters;
  prefs: Prefs;
  selected: Set<number>;
  ganttScale: GanttScale;
  kanbanSwimlanes: boolean;
  listeners: Set<() => void>;
}

export const store: StoreShape = {
  analysts: [],
  categories: [],
  view: "week",
  refDate: todayMonday(),
  filters: { analyst: "", category: "0", status: "", priority: "", q: "" },
  prefs: Object.assign(
    {
      colorBy: "category" as ColorBy,
      catColors: {} as Record<string, string>,
      density: "comfort" as Density,
      hideWeekends: false,
      legend: false,
      summary: true,
      sideCollapsed: false,
    },
    loadPrefs()
  ),
  selected: new Set<number>(),
  ganttScale: "week" as GanttScale,
  kanbanSwimlanes: false,
  listeners: new Set<() => void>(),
};

export function savePrefs(): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs));
}

export function subscribe(fn: () => void): () => void {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export function emit(): void {
  for (const fn of [...store.listeners]) fn();
}

export function currentZ(): number {
  return PPM * DENSITY_Z[store.prefs.density];
}

export function isGridView(v: ViewId): v is GridViewId {
  return v === "day" || v === "week" || v === "month" || v === "year";
}