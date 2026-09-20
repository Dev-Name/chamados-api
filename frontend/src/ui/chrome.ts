import { savePrefs, store } from "../core/state";

let toastTimer = 0;

export function showToast(msg: string): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2400);
}

export function openModal(id: string): void {
  document.getElementById(id)?.classList.add("open");
}

export function closeModal(id: string): void {
  document.getElementById(id)?.classList.remove("open");
}

export function closeAllModals(): void {
  document.querySelectorAll(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
}

export function anyModalOpen(): boolean {
  return !!document.querySelector(".modal-backdrop.open");
}

function closeBandMenus(): void {
  document.querySelectorAll(".band-menu.show").forEach((m) => m.classList.remove("show"));
  document.querySelectorAll(".bmenu.open").forEach((b) => {
    b.classList.remove("open");
    const lbl = b.closest(".band-label") as HTMLElement | null;
    if (lbl) lbl.style.zIndex = "";
  });
}

export function toggleBandMenu(id: number | string, btn: HTMLElement): void {
  const m = document.getElementById("bmenu-" + id) as HTMLElement | null;
  const open = m && m.classList.contains("show");
  closeBandMenus();
  if (m && !open) {
    m.classList.add("show");
    btn.classList.add("open");
    const lbl = btn.closest(".band-label") as HTMLElement | null;
    if (lbl) lbl.style.zIndex = "60";
  }
}

function syncHelpUI(): void {
  const on = document.getElementById("helpPop")?.classList.contains("show") ?? false;
  document.getElementById("helpBackdrop")?.classList.toggle("show", on);
  document.getElementById("helpBtn")?.classList.toggle("on", on);
}

export function toggleHelp(): void {
  document.getElementById("helpPop")?.classList.toggle("show");
  syncHelpUI();
}

export function closeHelp(): void {
  document.getElementById("helpPop")?.classList.remove("show");
  syncHelpUI();
}

function syncLegendLabel(): void {
  const on = document.getElementById("legendPop")?.classList.contains("show");
  const el = document.getElementById("menuLegend");
  if (el && on !== undefined) el.classList.toggle("on", on);
}

export function toggleLegend(): void {
  const pop = document.getElementById("legendPop");
  if (pop) pop.classList.toggle("show");
  syncLegendLabel();
}

export function closeLegend(): void {
  document.getElementById("legendPop")?.classList.remove("show");
  syncLegendLabel();
}

export function syncDensityUI(): void {
  const s = document.getElementById("densitySelect") as HTMLSelectElement | null;
  if (s) s.value = store.prefs.density;
}

export function syncWeekendUI(): void {
  const b = document.getElementById("weekendToggle");
  const on = !!store.prefs.showWeekend;
  if (b) {
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Ocultar sábado e domingo (fim de semana visível)" : "Mostrar sábado e domingo";
  }
}

export function applyUiPrefs(): void {
  document.documentElement.dataset.density = store.prefs.density;
  const sb = document.getElementById("summaryBar");
  if (sb) sb.hidden = !store.prefs.summary;
  const side = document.getElementById("side");
  if (side) side.classList.toggle("min", !!store.prefs.sideCollapsed);
  document.body.classList.toggle("side-min", !!store.prefs.sideCollapsed);
  const st = document.getElementById("sideToggle") as HTMLElement | null;
  if (st) st.title = store.prefs.sideCollapsed ? "Expandir menu" : "Recolher menu";
  const setOn = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("on", on);
  };
  setOn("menuSummary", !!store.prefs.summary);
  const wbtn = document.getElementById("weekendToggle");
  if (wbtn) wbtn.hidden = store.view !== "week" && store.view !== "gantt";
  syncHelpUI();
  syncLegendLabel();
  syncDensityUI();
  syncWeekendUI();
}

export function applyTheme(mode: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem("chamados-theme", mode);
  const l = document.getElementById("themeToggleLabel");
  if (l) l.textContent = mode === "dark" ? "Escuro" : "Claro";
}

export function wireChrome(): void {
  document.getElementById("sideToggle")?.addEventListener("click", () => {
    store.prefs.sideCollapsed = !store.prefs.sideCollapsed;
    savePrefs();
    applyUiPrefs();
  });

  document.getElementById("menuSummary")?.addEventListener("click", () => {
    store.prefs.summary = !store.prefs.summary;
    savePrefs();
    applyUiPrefs();
  });

  const menuLegend = document.getElementById("menuLegend");
  menuLegend?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLegend();
  });

  document.getElementById("helpBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHelp();
  });

  let utilOpen = false;
  const utilBtn = document.getElementById("utilBtn");
  const utilMenu = document.getElementById("utilMenu");
  const toggleUtil = () => { utilOpen = !utilOpen; if (utilMenu) utilMenu.classList.toggle("show", utilOpen); };
  utilBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleUtil(); });
  document.addEventListener("click", (e) => {
    if (utilOpen && !(e.target as HTMLElement).closest(".util-menu-wrap")) {
      utilOpen = false; if (utilMenu) utilMenu.classList.remove("show");
    }
  });

  document.getElementById("helpClose")?.addEventListener("click", () => closeHelp());
  document.getElementById("legendClose")?.addEventListener("click", () => closeLegend());
  document.getElementById("helpBackdrop")?.addEventListener("click", () => closeHelp());

  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    const saved = localStorage.getItem("chamados-theme");
    if (saved === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      applyTheme("dark");
    }
    themeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(cur);
    });
  }

  document.querySelectorAll<HTMLElement>("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal(b.dataset.close || ""))
  );

  document.querySelectorAll<HTMLElement>(".modal-backdrop").forEach((bd) =>
    bd.addEventListener("click", (e) => {
      if (e.target === bd) closeModal(bd.id);
    })
  );

  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest(".band-menu") && !t.closest("[data-menu]")) closeBandMenus();
    if (!t.closest("#helpPop") && !t.closest("#helpBtn")) closeHelp();
    if (!t.closest("#legendPop") && !t.closest("#menuLegend")) closeLegend();
  });
}