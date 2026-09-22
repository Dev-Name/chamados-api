import { store, emit } from "../core/state";

function mq(query: string): MediaQueryList {
  const f = window.matchMedia;
  if (typeof f !== "function")
    return { matches: false, media: query, addEventListener(): void {}, removeEventListener(): void {} } as unknown as MediaQueryList;
  return f(query);
}

const mqMobile = mq("(max-width: 767.5px)");
const mqBelowLg = mq("(max-width: 1023.5px)");

export function isMobileView(): boolean {
  return mqMobile.matches;
}

/* ---------------- menu lateral (drawer) ---------------- */

let drawerOpen = false;

function setDrawer(open: boolean): void {
  drawerOpen = open;
  const side = document.getElementById("side");
  const overlay = document.getElementById("sideOverlay");
  const btn = document.getElementById("mMenuBtn");
  side?.classList.toggle("open", open);
  overlay?.classList.toggle("open", open);
  document.body.classList.toggle("nav-open", open);
  btn?.setAttribute("aria-expanded", String(open));
  if (btn) btn.title = open ? "Fechar menu" : "Abrir menu";
  if (overlay) overlay.hidden = false;
}

export function closeDrawer(): void {
  if (drawerOpen) setDrawer(false);
}

/* ---------------- filtros (bottom-sheet mobile) ---------------- */

let sheetOpen = false;

function relocateSelects(): void {
  const sels = document.getElementById("fSelects");
  if (!sels) return;
  const target = mqMobile.matches
    ? document.getElementById("fSheetBody")
    : document.getElementById("fBarSelectsHost");
  if (!target) return;
  if (sels.parentElement !== target) target.appendChild(sels);
}

export function updateFilterCount(): void {
  const el = document.getElementById("fcount");
  if (!el) return;
  const active = [
    store.filters.analyst,
    store.filters.category && store.filters.category !== "0",
    store.filters.status,
    store.filters.priority,
    store.filters.q,
  ].filter(Boolean).length;
  el.textContent = active > 0 ? String(active) : "";
  el.hidden = active === 0;
}

export function openFilterSheet(): void {
  if (!mqMobile.matches) return;
  relocateSelects();
  const sheet = document.getElementById("filterSheet");
  const bd = document.getElementById("sheetBackdrop");
  const btn = document.getElementById("filterToggle");
  if (sheet) {
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
  }
  if (bd) bd.hidden = false;
  btn?.classList.add("active");
  sheetOpen = true;
}

export function closeFilterSheet(): void {
  const sheet = document.getElementById("filterSheet");
  const bd = document.getElementById("sheetBackdrop");
  const btn = document.getElementById("filterToggle");
  if (sheet) {
    sheet.hidden = true;
    sheet.setAttribute("aria-hidden", "true");
  }
  if (bd) bd.hidden = true;
  btn?.classList.remove("active");
  sheetOpen = false;
}

function toggleFilterSheet(): void {
  if (sheetOpen) closeFilterSheet();
  else openFilterSheet();
}

export function wireResponsive(): void {
  const mMenuBtn = document.getElementById("mMenuBtn");
  mMenuBtn?.addEventListener("click", () => setDrawer(!drawerOpen));

  const overlay = document.getElementById("sideOverlay");
  overlay?.addEventListener("click", () => closeDrawer());
  const side = document.getElementById("side");
  side?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".m-item") && mqBelowLg.matches) {
      closeDrawer();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (sheetOpen) {
      e.stopImmediatePropagation();
      closeFilterSheet();
      return;
    }
    if (drawerOpen) {
      closeDrawer();
      e.stopImmediatePropagation();
    }
  });

  /* intercepta o #filterToggle no mobile (vira gatilho do bottom-sheet).
     Registrado antes do wireTopbar para rodar primeiro. */
  const ft = document.getElementById("filterToggle");
  ft?.addEventListener("click", (e) => {
    if (!mqMobile.matches) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleFilterSheet();
  });

  document.getElementById("fSheetClose")?.addEventListener("click", closeFilterSheet);
  document.getElementById("sheetBackdrop")?.addEventListener("click", closeFilterSheet);
  document.getElementById("fSheetClear")?.addEventListener("click", () => {
    document.getElementById("f-clear")?.click();
  });

  relocateSelects();

  mqMobile.addEventListener("change", () => {
    relocateSelects();
    if (!mqMobile.matches && sheetOpen) closeFilterSheet();
    if (mqMobile.matches) emit();
  });
  mqBelowLg.addEventListener("change", () => {
    if (drawerOpen && !mqBelowLg.matches) closeDrawer();
  });
}