import type { ColorBy } from "../core/state";
import { savePrefs, store } from "../core/state";
import { categoryColor } from "../core/tickets";
import { categoriesFromTickets } from "../core/filters";
import { esc } from "../core/format";
import { openModal } from "./chrome";
import { emit } from "../core/state";

function renderSettings(): void {
  document.querySelectorAll<HTMLButtonElement>("#colorBySeg [data-colorby]").forEach((b) => {
    b.classList.toggle("active", b.dataset.colorby === store.prefs.colorBy);
  });
  const field = document.getElementById("catColorField");
  const list = document.getElementById("catColorList");
  const cats = store.categories.length ? store.categories : categoriesFromTickets();
  if (!field || !list) return;
  if (store.prefs.colorBy !== "category") {
    field.hidden = true;
    return;
  }
  field.hidden = false;
  list.innerHTML = "";
  for (const c of cats) {
    const row = document.createElement("div");
    const color = categoryColor(c.id);
    row.className = "cat-color-row";
    row.innerHTML = `<input type="color" value="${color}" data-cat-color="${c.id}"><span class="cn">${esc(c.name)}</span>`;
    list.appendChild(row);
  }
  list.querySelectorAll<HTMLInputElement>('input[type="color"]').forEach((inp) => {
    inp.addEventListener("input", () => {
      store.prefs.catColors[inp.dataset.catColor || ""] = inp.value;
      savePrefs();
      emit();
    });
  });
}

export function wireSettingsModal(): void {
  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    renderSettings();
    openModal("settingsModal");
  });
  document.querySelectorAll<HTMLButtonElement>("#colorBySeg [data-colorby]").forEach((b) => {
    b.addEventListener("click", () => {
      store.prefs.colorBy = b.dataset.colorby as ColorBy;
      savePrefs();
      renderSettings();
      emit();
    });
  });
}