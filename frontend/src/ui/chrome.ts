import { savePrefs, store, emit } from "../core/state";

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
  const el = document.getElementById(id);
  el?.classList.remove("open");
  const active = document.activeElement as HTMLElement | null;
  if (active && el && el.contains(active)) active.blur();
}

export function closeAllModals(): void {
  document.querySelectorAll(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
  (document.activeElement as HTMLElement | null)?.blur();
}

/* ---------- camadas flutuantes portalizadas no <body> (root da aplicação)
   Posicionamento fixo na viewport com flip vertical/horizontal: nunca cortado
   por containers com rolagem (#calWrap) nem pelas bordas da janela. ---------- */
interface FloatRec { parent: Node; next: Node | null }
const portaled = new Map<HTMLElement, FloatRec>();

function portalFloat(el: HTMLElement, anchor: HTMLElement): void {
  if (!portaled.has(el)) {
    const parent = el.parentElement;
    if (parent) {
      portaled.set(el, { parent, next: el.nextSibling });
      document.body.appendChild(el);
    }
  }
  el.style.position = "fixed";
  el.style.left = "0px";
  el.style.top = "0px";
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  const gap = 6;
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  const below = r.bottom + gap;
  const above = r.top - gap - mh;
  let top = below;
  if (below + mh > window.innerHeight - pad && above >= pad) top = above; /* flip vertical */
  top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - mh - pad));
  let left = r.left;
  if (left + mw > window.innerWidth - pad) left = Math.max(pad, r.right - mw); /* flip horizontal */
  el.style.left = left + "px";
  el.style.top = top + "px";
}

function unportalFloat(el: HTMLElement): void {
  const rec = portaled.get(el);
  el.style.position = "";
  el.style.left = "";
  el.style.top = "";
  if (!rec) return;
  portaled.delete(el);
  if (rec.next && rec.next.parentNode === rec.parent) rec.parent.insertBefore(el, rec.next);
  else rec.parent.appendChild(el);
}

function closeBandMenus(): void {
  document.querySelectorAll<HTMLElement>(".band-menu.show").forEach((m) => {
    m.classList.remove("show");
    unportalFloat(m);
  });
  document.querySelectorAll(".bmenu.open").forEach((b) => b.classList.remove("open"));
}

function closeDensityMenu(): void {
  const menu = document.getElementById("densityMenu");
  const trig = document.querySelector(".cs-trigger");
  if (menu) {
    menu.classList.remove("open");
    unportalFloat(menu);
  }
  if (trig) trig.setAttribute("aria-expanded", "false");
}

/** Fecha qualquer camada flutuante portalizada (menus de analista e densidade). */
export function closeFloats(): void {
  closeBandMenus();
  closeDensityMenu();
}

export function toggleBandMenu(id: number | string, btn: HTMLElement): void {
  const m = document.getElementById("bmenu-" + id) as HTMLElement | null;
  const open = m && m.classList.contains("show");
  closeBandMenus();
  if (m && !open) {
    m.classList.add("show");
    btn.classList.add("open");
    portalFloat(m, btn);
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
  const lbl = document.getElementById("densityLabel");
  const opt = document.querySelector<HTMLElement>("#densityMenu .cs-option[selected]");
  if (lbl && opt) lbl.textContent = opt.textContent ?? "";
  closeDensityMenu();
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
  const utilWrap = document.getElementById("utilMenuWrap");
  const toggleUtil = () => { utilOpen = !utilOpen; if (utilWrap) utilWrap.classList.toggle("open", utilOpen); };
  utilBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleUtil(); });

  const densityMenu = document.getElementById("densityMenu");
  densityMenu?.addEventListener("click", (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>(".cs-option");
    if (!opt) return;
    const val = opt.dataset.value;
    if (val) {
      store.prefs.density = val as "compact" | "comfort" | "expanded";
      savePrefs();
      document.querySelectorAll("#densityMenu .cs-option").forEach((o) => o.removeAttribute("selected"));
      opt.setAttribute("selected", "");
      syncDensityUI();
      applyUiPrefs();
      emit();
    }
    closeDensityMenu();
  });

  const csTrigger = document.querySelector<HTMLElement>(".cs-trigger");
  csTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = document.getElementById("densityMenu");
    const isOpen = menu?.classList.contains("open") ?? false;
    closeDensityMenu();
    if (menu && !isOpen && csTrigger) {
      menu.classList.add("open");
      csTrigger.setAttribute("aria-expanded", "true");
      portalFloat(menu, csTrigger);
    }
    document.getElementById("utilMenu")?.classList.remove("open");
    document.getElementById("utilMenuWrap")?.classList.remove("open");
  });

  /* teclado no dropdown de densidade: setras navegam, Enter/Espaço ativam, Esc fecha */
  const densityOpts = () => Array.from(document.querySelectorAll<HTMLElement>("#densityMenu .cs-option"));
  csTrigger?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      csTrigger.click();
      requestAnimationFrame(() => densityOpts()[0]?.focus());
    }
  });
  document.getElementById("densityMenu")?.addEventListener("keydown", (e) => {
    const list = densityOpts();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1 + list.length) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDensityMenu();
      csTrigger?.focus();
    }
  });

  document.addEventListener("click", () => {
    closeDensityMenu();
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