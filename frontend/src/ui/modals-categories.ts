import type { Category } from "../core/state";
import { CATEGORY_COLOR_OPTIONS, store } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import { esc } from "../core/format";
import { closeModal, openModal, showToast } from "./chrome";
import { enhanceSelect, syncCustomSelect } from "./custom-select";

const ICON_PEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

let editingId: number | null = null;

/** Preenche o select de cores (bolinhas de cor ao lado do rótulo). */
function fillColorSelect(selected: string | null): void {
  const sel = document.getElementById("cat-color") as HTMLSelectElement;
  if (!sel) return;
  sel.innerHTML = "";
  const normSelected = selected ? selected.toLowerCase() : "";
  let matched = false;
  for (const c of CATEGORY_COLOR_OPTIONS) {
    const o = document.createElement("option");
    o.value = c.value;
    o.textContent = c.label;
    o.dataset.color = c.value;
    if (c.value.toLowerCase() === normSelected) {
      o.selected = true;
      matched = true;
    }
    sel.appendChild(o);
  }
  // Cor salva fora da paleta (ex.: definida no Visual) continua editável como "Personalizada"
  if (!matched && selected) {
    const o = document.createElement("option");
    o.value = selected;
    o.textContent = "Personalizada";
    o.dataset.color = selected;
    o.selected = true;
    sel.appendChild(o);
  }
  if (!matched && !selected) sel.value = CATEGORY_COLOR_OPTIONS[0].value;
  enhanceSelect(sel);
  syncCustomSelect(sel);
}

function openCategoryEditor(id: number | null): void {
  editingId = id;
  const cat: Category | null = id == null ? null : (store.categories.find((c) => c.id === id) ?? null);
  const title = document.getElementById("categoryModalTitle")!;
  const nameEl = document.getElementById("cat-name") as HTMLInputElement;
  title.textContent = cat ? "Editar categoria" : "Nova categoria";
  nameEl.value = cat ? cat.name : "";
  fillColorSelect(cat?.cor ?? null);
  openModal("categoryModal");
  window.setTimeout(() => nameEl.focus(), 0);
}

async function saveCategory(): Promise<void> {
  const nameEl = document.getElementById("cat-name") as HTMLInputElement;
  const colorSel = document.getElementById("cat-color") as HTMLSelectElement;
  const name = nameEl.value.trim();
  if (!name) {
    showToast("Informe o nome da categoria");
    nameEl.focus();
    return;
  }
  const payload = { name, cor: colorSel.value };
  try {
    if (editingId == null) {
      await api("/categories", "POST", payload);
      showToast("Categoria criada");
    } else {
      await api("/categories/" + editingId, "PATCH", payload);
      showToast("Categoria atualizada");
    }
    closeModal("categoryModal");
    await reloadAfterMutation();
    renderCategoryList();
  } catch (err) {
    showToast("Erro: " + (err as Error).message);
  }
}

async function removeCategory(id: number): Promise<void> {
  const cat = store.categories.find((c) => c.id === id);
  if (!cat) return;
  if (!window.confirm(`Excluir a categoria "${cat.name}"?`)) return;
  try {
    await api("/categories/" + id, "DELETE");
    showToast("Categoria excluída");
    await reloadAfterMutation();
    renderCategoryList();
  } catch (err) {
    showToast("Erro: " + (err as Error).message);
  }
}

export function renderCategoryList(): void {
  const list = document.getElementById("categoriesList");
  if (!list) return;
  list.innerHTML = "";
  if (store.categories.length === 0) {
    list.innerHTML = '<div class="empty">Nenhuma categoria ainda. Crie a primeira com "+ Nova categoria".</div>';
    return;
  }
  for (const c of store.categories) {
    const count = c._count?.tickets ?? 0;
    const row = document.createElement("div");
    row.className = "cat-row" + (c.ativo ? "" : " inact");
    row.innerHTML = `
      <span class="cat-flag" style="background:${esc(c.cor)}" title="${esc(c.cor)}"></span>
      <span class="cat-name">${esc(c.name)}</span>
      ${c.ativo ? "" : '<span class="a-badge inact">Inativa</span>'}
      <span class="cat-count" title="${count} ${count === 1 ? "chamado" : "chamados"} vinculados">${count} ${count === 1 ? "chamado" : "chamados"}</span>
      <div class="cat-actions">
        <button class="ghost sm" data-cat-edit="${c.id}" title="Editar categoria">${ICON_PEN}Editar</button>
        <button type="button" class="icon-btn danger" data-cat-del="${c.id}" title="Excluir categoria">${ICON_TRASH}</button>
      </div>`;
    list.appendChild(row);
  }
}

export function wireCategoriesModal(): void {
  document.getElementById("categoriesMenu")?.addEventListener("click", () => {
    renderCategoryList();
    openModal("categoriesModal");
  });
  document.getElementById("cat-add")?.addEventListener("click", () => openCategoryEditor(null));
  document.getElementById("cat-save")?.addEventListener("click", () => void saveCategory());
  const nameInput = document.getElementById("cat-name") as HTMLInputElement | null;
  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveCategory();
    }
  });
  document.getElementById("categoriesList")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const del = target.closest<HTMLElement>("[data-cat-del]");
    if (del) {
      void removeCategory(Number(del.dataset.catDel));
      return;
    }
    const edit = target.closest<HTMLElement>("[data-cat-edit]");
    if (edit) openCategoryEditor(Number(edit.dataset.catEdit));
  });
}