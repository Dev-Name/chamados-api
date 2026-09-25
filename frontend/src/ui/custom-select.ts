const CHEVRON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

const handles = new Map<HTMLSelectElement, { label: HTMLElement; menu: HTMLElement }>();

function isOptGroup(el: HTMLElement): boolean {
  return el.tagName === "OPTGROUP";
}

/**
 * Substitui visualmente um <select> nativo por um dropdown estilizado.
 * O select original é ocultado mas permanece no DOM: `value` e eventos `change`
 * continuam funcionando para a lógica existente. O menu é reconstruído a cada
 * abertura (reflete innerHTML/opções dinâmicas, ex. #t-depends).
 */
export function enhanceSelect(sel: HTMLSelectElement): void {
  if (handles.has(sel)) return;
  const parent = sel.parentElement;
  if (!parent) return;

  sel.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = "cs-field";

  const trig = document.createElement("button");
  trig.type = "button";
  trig.className = "cs-field-trigger";
  trig.setAttribute("aria-haspopup", "listbox");

  const label = document.createElement("span");
  label.className = "cs-field-label";
  const caret = document.createElement("span");
  caret.className = "cs-field-caret";
  caret.innerHTML = CHEVRON;
  trig.append(label, caret);

  const menu = document.createElement("div");
  menu.className = "cs-field-menu";
  menu.setAttribute("role", "listbox");

  wrap.append(trig, menu);
  parent.insertBefore(wrap, sel.nextSibling);

  const syncLabel = (): void => {
    const opt = sel.selectedOptions[0];
    label.textContent = opt ? opt.textContent : sel.dataset.nullLabel ?? "Selecionar…";
    label.title = opt ? opt.textContent : "";
  };

  const buildMenu = (): void => {
    menu.innerHTML = "";
    let group: string | null = null;
    for (const opt of Array.from(sel.options)) {
      if (opt.parentElement) {
        const og = opt.parentElement as HTMLOptGroupElement;
        if (isOptGroup(og) && og.label !== group) {
          group = og.label;
          const gh = document.createElement("div");
          gh.className = "cs-field-group";
          gh.textContent = group;
          menu.appendChild(gh);
        } else if (!isOptGroup(og)) {
          group = null;
        }
      }
      const o = document.createElement("button");
      o.type = "button";
      o.className = "cs-field-opt";
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", String(opt.selected));
      o.textContent = opt.textContent || "";
      if (opt.disabled) o.disabled = true;
      if (opt.selected) o.classList.add("sel");
      o.addEventListener("click", () => {
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        menu.classList.remove("open");
        trig.setAttribute("aria-expanded", "false");
        syncLabel();
      });
      menu.appendChild(o);
    }
  };

  const open = (): void => {
    buildMenu();
    menu.classList.add("open");
    trig.setAttribute("aria-expanded", "true");
  };

  trig.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      trig.setAttribute("aria-expanded", "false");
    } else {
      open();
    }
  });

  menu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => closeSelectOf(sel));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSelectOf(sel);
  });

  handles.set(sel, { label, menu });
  syncLabel();
}

function closeSelectOf(sel: HTMLSelectElement): void {
  const rec = handles.get(sel);
  if (!rec) return;
  rec.menu.classList.remove("open");
  const trig = rec.menu.previousElementSibling as HTMLElement | null;
  trig?.setAttribute("aria-expanded", "false");
}

/** Sincroniza o rótulo de um select já aprimorado (após mudanças programáticas de valor). */
export function syncCustomSelect(sel: HTMLSelectElement): void {
  const rec = handles.get(sel);
  if (!rec) return;
  const opt = sel.selectedOptions[0];
  rec.label.textContent = opt ? opt.textContent || "" : (sel.dataset.nullLabel ?? "Selecionar…");
  rec.label.title = opt ? opt.textContent || "" : "";
}