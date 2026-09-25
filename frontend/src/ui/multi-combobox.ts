export interface MultiOption {
  value: string;
  label: string;
  disabled?: boolean;
  avatar?: string;
}

interface ComboState {
  options: MultiOption[];
  selected: Set<string>;
  trigger: HTMLElement;
  tags: HTMLElement;
  menu: HTMLElement;
  placeholder: string;
  host: HTMLElement;
  onChange?: () => void;
}

const states = new WeakMap<HTMLElement, ComboState>();
const CHEVRON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

function selectedOptions(s: ComboState): MultiOption[] {
  return s.options.filter((o) => s.selected.has(o.value));
}

function renderTags(s: ComboState): void {
  s.tags.innerHTML = "";
  const chosen = selectedOptions(s);
  if (chosen.length === 0) {
    const ph = document.createElement("span");
    ph.className = "ana-combo-ph";
    ph.textContent = s.placeholder;
    s.tags.appendChild(ph);
    return;
  }
  for (const o of chosen) {
    const tag = document.createElement("span");
    tag.className = "ana-tag";
    if (o.avatar) tag.insertAdjacentHTML("afterbegin", o.avatar);
    const nm = document.createElement("span");
    nm.textContent = o.label;
    tag.appendChild(nm);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "ana-tag-x";
    x.setAttribute("aria-label", "Remover " + o.label);
    x.textContent = "×";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      setChecked(s, o.value, false);
    });
    tag.appendChild(x);
    s.tags.appendChild(tag);
  }
}

function renderMenu(s: ComboState): void {
  s.menu.innerHTML = "";
  for (const o of s.options) {
    const label = document.createElement("label");
    label.className = "ana-opt" + (o.disabled && !s.selected.has(o.value) ? " is-disabled" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = o.value;
    cb.checked = s.selected.has(o.value);
    if (o.disabled && !cb.checked) cb.disabled = true;
    label.appendChild(cb);
    if (o.avatar) label.insertAdjacentHTML("beforeend", o.avatar);
    const nm = document.createElement("span");
    nm.className = "ana-opt-nm";
    nm.textContent = o.label;
    label.appendChild(nm);
    label.addEventListener("click", (e) => {
      if (cb.disabled) e.preventDefault();
    });
    cb.addEventListener("change", () => {
      if (cb.checked) s.selected.add(o.value);
      else s.selected.delete(o.value);
      renderTags(s);
      s.host?.dispatchEvent(new Event("change", { bubbles: true }));
      s.onChange?.();
    });
    s.menu.appendChild(label);
  }
}

function setChecked(s: ComboState, value: string, checked: boolean): void {
  if (checked) s.selected.add(value);
  else s.selected.delete(value);
  const cb = s.menu.querySelector<HTMLInputElement>(`input[value="${value}"]`);
  if (cb) cb.checked = checked;
  renderTags(s);
  s.host?.dispatchEvent(new Event("change", { bubbles: true }));
  s.onChange?.();
}

/** Constrói (ou re-renderiza) um combobox multi-select dentro de `host`. */
export function renderMultiCombo(
  host: HTMLElement,
  options: MultiOption[],
  opts: { placeholder?: string; selected?: string[]; onChange?: () => void } = {}
): void {
  const existing = states.get(host);
  const s: ComboState = existing ?? {
    options: [],
    selected: new Set<string>(),
    trigger: document.createElement("div"),
    tags: document.createElement("div"),
    menu: document.createElement("div"),
    placeholder: opts.placeholder ?? "Selecionar…",
    host,
  };
  s.options = options;
  s.selected = new Set(opts.selected ?? []);
  s.placeholder = opts.placeholder ?? s.placeholder;
  s.onChange = opts.onChange;
  s.host = host;

  if (!existing) {
    host.classList.add("ana-combo");

    s.trigger.className = "ana-combo-trigger";
    s.trigger.setAttribute("role", "combobox");
    s.trigger.setAttribute("aria-haspopup", "listbox");
    s.tags.className = "ana-tags";
    const caret = document.createElement("span");
    caret.className = "ana-combo-caret";
    caret.innerHTML = CHEVRON;
    s.trigger.append(s.tags, caret);
    s.menu.className = "ana-combo-menu";
    s.menu.setAttribute("role", "listbox");

    s.trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = host.classList.contains("open");
      closeMultiCombos();
      if (!isOpen) {
        renderMenu(s);
        host.classList.add("open");
        s.trigger.setAttribute("aria-expanded", "true");
      }
    });
    host.addEventListener("click", (e) => e.stopPropagation());

    host.append(s.trigger, s.menu);
    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        host.classList.remove("open");
        s.trigger.setAttribute("aria-expanded", "false");
      }
    });
    states.set(host, s);
  } else {
    s.trigger.setAttribute("aria-expanded", "false");
  }

  renderTags(s);
  renderMenu(s);
  host.classList.remove("open");
}

/** Fecha todos os comboboxes multi-select abertos. */
export function closeMultiCombos(): void {
  document.querySelectorAll<HTMLElement>(".ana-combo.open").forEach((el) => {
    el.classList.remove("open");
    el.querySelector<HTMLElement>(".ana-combo-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function closeAll(): void {
  closeMultiCombos();
}