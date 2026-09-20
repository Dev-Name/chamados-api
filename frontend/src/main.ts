import "./styles/base.css";
import "./styles/grid.css";
import "./styles/views.css";

import { store, emit, subscribe, savePrefs } from "./core/state";
import type { ViewId } from "./core/state";
import { api, loadCategories, loadAnalysts, setReloadHook } from "./core/api";
import { fillFilterSelects, visibleAnalysts } from "./core/filters";
import { periodDays, periodLabel, go, setView } from "./core/nav";
import { renderGrid, wireGridView, moveNow, cancelDrag } from "./views/grid";
import { renderKanban, wireKanbanClick } from "./views/kanban";
import { renderTable } from "./views/table";
import { renderLoad } from "./views/load";
import { renderGantt } from "./views/gantt";
import { applyUiPrefs, wireChrome, showToast, closeAllModals, syncDensityUI, syncWeekendUI } from "./ui/chrome";
import { wireTicketModal } from "./ui/modals-ticket";
import { wireAnalystsModal } from "./ui/modals-analyst";
import { wireQueueModal } from "./ui/modals-queue";
import { wireReportModal } from "./ui/modals-report";
import { wireSettingsModal } from "./ui/modals-settings";
import { isOverdue, remainOf } from "./core/tickets";
import { fmtNum, startOf } from "./core/format";

const GRID_VIEWS = ["day", "week", "month", "year"];

function updateSummary(): void {
  const bar = document.getElementById("summaryBar");
  if (!bar) return;
  if (!store.prefs.summary || !GRID_VIEWS.includes(store.view)) {
    bar.innerHTML = "";
    return;
  }
  const days = periodDays();
  let active = 0;
  let late = 0;
  let remain = 0;
  for (const a of visibleAnalysts()) {
    for (const t of a.tickets) {
      if (t.status === "COMPLETED") continue;
      active++;
      if (isOverdue(t)) late++;
      remain += remainOf(t);
    }
  }
  let dayWork = 0;
  for (const d of days) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    dayWork += visibleAnalysts().reduce((s, a) => s + (a.weeklyCapacityMinutes[d.getDay()] || 0), 0);
  }
  bar.innerHTML =
    `<div class="sum-chips">` +
    `<span class="sum-chip"><b>${days.length}</b> dias</span>` +
    `<span class="sum-chip"><b>${active}</b> chamados ativos</span>` +
    `<span class="sum-chip"><b>${fmtNum(remain)}</b> restantes</span>` +
    (dayWork ? `<span class="sum-chip"><b>${fmtNum(dayWork)}</b> de capacidade</span>` : "") +
    (late ? `<span class="sum-chip bad"><b>${late}</b> atrasado(s)</span>` : "") +
    `</div>`;
}

function updateLive(): void {
  const el = document.getElementById("liveText");
  if (el) {
    const d = new Date();
    el.textContent = "ao vivo · " + d.toLocaleTimeString("pt-BR");
  }
}

function setActiveViewTabs(): void {
  document.querySelectorAll<HTMLElement>("#viewSwitch [data-view], #viewSwitch2 [data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === store.view);
  });
}

function paint(): void {
  fillFilterSelects();
  applyUiPrefs();
  setActiveViewTabs();
  const title = document.getElementById("weekTitle");
  if (title) title.textContent = periodLabel();
  updateSummary();
  const wrap = document.getElementById("calWrap")!;
  const container = document.getElementById("viewContainer")!;
  const isGrid = GRID_VIEWS.includes(store.view);
  wrap.hidden = !isGrid;
  container.hidden = isGrid;
  if (store.view === "day" || store.view === "week" || store.view === "month" || store.view === "year") {
    renderGrid();
  } else if (store.view === "kanban") {
    renderKanban();
  } else if (store.view === "table") {
    renderTable();
  } else if (store.view === "load") {
    renderLoad();
  } else if (store.view === "gantt") {
    renderGantt();
  }
  updateLive();
}

async function fullReload(): Promise<void> {
  try {
    await Promise.all([loadCategories(), loadAnalysts()]);
    paint();
  } catch (err) {
    const e = document.getElementById("err");
    if (e) {
      e.hidden = false;
      e.textContent = "Erro ao carregar dados: " + (err as Error).message;
    }
  }
}

let qDebounce: ReturnType<typeof setTimeout> | undefined;

function wireTopbar(): void {
  document.querySelectorAll<HTMLElement>("#viewSwitch [data-view], #viewSwitch2 [data-view]").forEach((b) =>
    b.addEventListener("click", () => setView(b.dataset.view as ViewId))
  );
  document.getElementById("prev")?.addEventListener("click", () => go(-1));
  document.getElementById("next")?.addEventListener("click", () => go(1));
  document.getElementById("today")?.addEventListener("click", () => {
    store.refDate = startOf(new Date());
    emit();
  });

  const selMap = [
    ["f-analyst", "analyst"],
    ["f-category", "category"],
    ["f-status", "status"],
    ["f-priority", "priority"],
  ] as const;
  for (const [id, key] of selMap) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      store.filters[key] = (e.target as HTMLSelectElement).value;
      emit();
    });
  }
  const q = document.getElementById("f-q") as HTMLInputElement | null;
  q?.addEventListener("input", () => {
    store.filters.q = q.value;
    clearTimeout(qDebounce);
    qDebounce = setTimeout(emit, 150);
  });
  document.getElementById("f-clear")?.addEventListener("click", () => {
    store.filters = { analyst: "", category: "0", status: "", priority: "", q: "" };
    if (q) q.value = "";
    emit();
  });

  document.querySelectorAll<HTMLElement>("#densitySeg [data-density]").forEach((b) =>
    b.addEventListener("click", () => {
      store.prefs.density = b.dataset.density as "compact" | "comfort" | "expanded";
      savePrefs();
      syncDensityUI();
      applyUiPrefs();
      emit();
    })
  );
  document.getElementById("weekendToggle")?.addEventListener("click", () => {
    store.prefs.hideWeekends = !store.prefs.hideWeekends;
    savePrefs();
    syncWeekendUI();
    emit();
  });

  document.getElementById("recalcAll")?.addEventListener("click", async () => {
    try {
      await api("/recalculate", "POST");
      showToast("Filas recalculadas");
      await fullReload();
    } catch (err) {
      showToast("Erro: " + (err as Error).message);
    }
  });
}

function keyboard(e: KeyboardEvent): void {
  const tag = (document.activeElement?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (anyModalOpen()) {
    if (e.key === "Escape") closeAllModals();
    return;
  }
  if (e.key === "Escape") {
    if (cancelDrag()) return;
    document.querySelectorAll<HTMLElement>(".band-menu.show").forEach((m) => m.classList.remove("show"));
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "g") {
    store.ganttScale = "week";
    setView("gantt");
  }
  else if (k === "d") setView("day");
  else if (k === "w") setView("week");
  else if (k === "m") setView("month");
  else if (k === "a" || k === "y") setView("year");
  else if (k === "k") setView("kanban");
  else if (k === "t") setView("table");
  else if (k === "c") setView("load");
  else if (k === "?") document.getElementById("helpPop")?.classList.toggle("show");
  else if (e.key === "ArrowLeft") go(-1);
  else if (e.key === "ArrowRight") go(1);
}

function anyModalOpen(): boolean {
  return !!document.querySelector(".modal-backdrop.open");
}

function startClock(): void {
  setInterval(() => {
    updateLive();
    moveNow();
  }, 60000);
}

function init(): void {
  wireChrome();
  wireTicketModal();
  wireAnalystsModal();
  wireQueueModal();
  wireReportModal();
  wireSettingsModal();
  wireGridView();
  wireKanbanClick();
  wireTopbar();
  setReloadHook(async () => fullReload());
  subscribe(() => paint());
  document.addEventListener("keydown", keyboard);
  startClock();
  applyUiPrefs();
  fullReload();
}

init();