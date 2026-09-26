import type { Analyst, Ticket } from "../core/state";
import { statusLabel, store } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import { categoriesFromTickets } from "../core/filters";
import { analystOptionInfo, avatarHtml, capOfDow, lunchForDow, startForDow } from "../core/analysts";
import { fmtDay, fmtTime } from "../core/format";
import { closeModal, openModal, showToast } from "./chrome";
import { refreshTicketsModal } from "./modals-tickets";
import { enhanceSelect, syncCustomSelect } from "./custom-select";
import { renderMultiCombo } from "./multi-combobox";

export function findTicket(id: number): Ticket | null {
  for (const a of store.analysts) {
    const found = a.tickets.find((t) => t.id === id);
    if (found) return found;
  }
  return null;
}

function fillDependsSelect(editTicket: Ticket | null): void {
  const depSel = document.getElementById("t-depends") as HTMLSelectElement;
  const current = depSel.value;
  depSel.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = depSel.dataset.nullLabel || "— nenhum —";
  depSel.appendChild(noneOpt);
  for (const a of store.analysts) {
    const shown = a.tickets.filter((t) => !editTicket || t.id !== editTicket.id);
    if (shown.length === 0) continue;
    const group = document.createElement("optgroup");
    group.label = a.name;
    for (const t of shown) {
      const o = document.createElement("option");
      o.value = String(t.id);
      o.textContent = `#${t.id} ${t.title} (${statusLabel[t.status] || t.status}${t.dueDate ? " • " + fmtDay(new Date(t.dueDate)) : ""})`;
      if ((current && String(current) === String(t.id)) || (editTicket && editTicket.dependsOnTicketId === t.id)) o.selected = true;
      group.appendChild(o);
    }
    depSel.appendChild(group);
  }
  syncCustomSelect(depSel);
}

/** Preenche o combobox multi-select "Analistas Responsáveis". */
function fillAssigneesCombo(editTicket: Ticket | null, presetIds: number[] = []): void {
  const host = document.getElementById("t-assignees") as HTMLElement;
  if (!host) return;
  const selected = new Set<number>(presetIds);
  for (const id of editTicket?.analystIds ?? []) selected.add(id);
  const options = store.analysts.map((a) => {
    const info = analystOptionInfo(a, null);
    return {
      value: String(a.id),
      label: info.label,
      disabled: info.disabled,
      avatar: avatarHtml(a, 18),
    };
  });
  renderMultiCombo(host, options, {
    placeholder: "Selecionar analistas…",
    selected: [...selected].map(String),
  });
}

function fillTicketSelects(editTicket: Ticket | null, presetAnalystId: number | null = null): void {
  const catSel = document.getElementById("t-category") as HTMLSelectElement;
  catSel.innerHTML = "";
  const cats: { id: number; name: string; cor?: string }[] = store.categories.length
    ? store.categories.filter((c) => c.ativo || (editTicket && editTicket.categoryId === c.id))
    : categoriesFromTickets();
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = String(c.id);
    o.textContent = c.name;
    if (c.cor) o.dataset.color = c.cor;
    if (editTicket && editTicket.categoryId === c.id) o.selected = true;
    catSel.appendChild(o);
  }
  syncCustomSelect(catSel);
  fillAssigneesCombo(editTicket, !editTicket && presetAnalystId ? [presetAnalystId] : []);
  const priSel = document.getElementById("t-priority") as HTMLSelectElement;
  priSel.innerHTML = "";
  for (let p = 1; p <= 5; p++) {
    const o = document.createElement("option");
    o.value = String(p);
    o.textContent = "P" + p + (p === 1 ? " (urgente)" : "");
    if (editTicket && editTicket.priority === p) o.selected = true;
    priSel.appendChild(o);
  }
  syncCustomSelect(priSel);
  const stSel = document.getElementById("t-status") as HTMLSelectElement;
  stSel.innerHTML = "";
  for (const [k, v] of Object.entries(statusLabel)) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = v;
    if (editTicket && editTicket.status === k) o.selected = true;
    stSel.appendChild(o);
  }
  syncCustomSelect(stSel);
  fillDependsSelect(editTicket);
}

/** Converte ISO (UTC) para o formato aceito por <input type="datetime-local"> (hora local). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function syncCompletedField(): void {
  const status = (document.getElementById("t-status") as HTMLSelectElement).value;
  const wrap = document.getElementById("t-completed-wrap") as HTMLElement;
  const input = document.getElementById("t-completed") as HTMLInputElement;
  const completed = status === "COMPLETED";
  if (completed) {
    if (wrap.hidden) wrap.hidden = false;
    if (!input.value) input.value = toLocalInput(new Date().toISOString());
  } else if (!wrap.hidden) {
    wrap.hidden = true;
    input.value = "";
  }
}

const MINUTE_MS = 60000;
const DAY_MS = 24 * 3600 * 1000;

/** Distribui minutos de trabalho na jornada do analista a partir de um instante (considera folgas, almoço e ausências). */
function allocateMinutes(a: Analyst, from: Date, minutes: number): Date | null {
  let remain = minutes;
  const fromTs = from.getTime();
  let day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 730 && remain > 0; i++) {
    const dow = day.getDay();
    const cap = capOfDow(a, dow);
    if (cap > 0) {
      const start = startForDow(a, dow);
      const s = day.getTime() + start * MINUTE_MS;
      const e = s + cap * MINUTE_MS;
      const cur = Math.max(fromTs, s);
      if (cur < e) {
        let avail = (e - cur) / MINUTE_MS;
        const lunch = lunchForDow(a, dow);
        if (lunch) {
          const ls = day.getTime() + lunch.start * MINUTE_MS;
          const le = day.getTime() + lunch.end * MINUTE_MS;
          const os = Math.max(cur, ls);
          const oe = Math.min(e, le);
          if (oe > os) avail -= (oe - os) / MINUTE_MS;
        }
        for (const ab of a.absences || []) {
          const abS = new Date(ab.data_hora_inicio).getTime();
          const abE = new Date(ab.data_hora_fim).getTime();
          const os = Math.max(cur, abS);
          const oe = Math.min(e, abE);
          if (oe > os) avail -= (oe - os) / MINUTE_MS;
        }
        if (avail > 0) {
          const used = Math.min(avail, remain);
          remain -= used;
          if (remain <= 0) return new Date(cur + used * MINUTE_MS);
        }
      }
    }
    day = new Date(day.getTime() + DAY_MS);
  }
  return null;
}

/** Distribui minutos na jornada combinada dos analistas da equipe (soma capacidade produtiva de todos, descontando almoço e ausências). */
function allocateTeam(assignees: Analyst[], from: Date, minutes: number): Date | null {
  let remain = minutes;
  const fromTs = from.getTime();
  let day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 730 && remain > 0; i++) {
    const dow = day.getDay();
    const starts: number[] = [];
    const ends: number[] = [];
    let cap = 0;
    for (const a of assignees) {
      const c = capOfDow(a, dow);
      if (c <= 0) continue;
      const start = day.getTime() + startForDow(a, dow) * MINUTE_MS;
      const end = start + c * MINUTE_MS;
      const cur = Math.max(fromTs, start);
      if (cur >= end) continue;
      let avail = (end - cur) / MINUTE_MS;
      const lunch = lunchForDow(a, dow);
      if (lunch) {
        const ls = day.getTime() + lunch.start * MINUTE_MS;
        const le = day.getTime() + lunch.end * MINUTE_MS;
        const os = Math.max(cur, ls);
        const oe = Math.min(end, le);
        if (oe > os) avail -= (oe - os) / MINUTE_MS;
      }
      for (const ab of a.absences || []) {
        const abS = new Date(ab.data_hora_inicio).getTime();
        const abE = new Date(ab.data_hora_fim).getTime();
        const os = Math.max(cur, abS);
        const oe = Math.min(end, abE);
        if (oe > os) avail -= (oe - os) / MINUTE_MS;
      }
      if (avail <= 0) continue;
      starts.push(Math.max(fromTs, start));
      ends.push(end);
      cap += avail;
    }
    if (cap <= 0) {
      day = new Date(day.getTime() + DAY_MS);
      continue;
    }
    if (remain <= cap) {
      const firstStart = Math.min(...starts);
      const lastEnd = Math.max(...ends);
      const span = lastEnd - firstStart;
      const frac = remain / cap;
      return new Date(firstStart + span * frac);
    }
    remain -= cap;
    day = new Date(day.getTime() + DAY_MS);
  }
  return null;
}

/** Ids dos analistas selecionados no combobox. */
function getAssigneeIds(): number[] {
  return [...document.querySelectorAll<HTMLInputElement>("#t-assignees input:checked")].map((i) => Number(i.value));
}

function estimateEta(): Date | null {
  const status = (document.getElementById("t-status") as HTMLSelectElement).value;
  if (status === "COMPLETED") return null;
  const ids = getAssigneeIds();
  const assignees = store.analysts.filter((x) => ids.includes(x.id));
  if (assignees.length === 0) return null;
  const editId = Number((document.getElementById("t-save") as HTMLButtonElement).dataset.id) || 0;
  const est = Number((document.getElementById("t-minutes") as HTMLInputElement).value) || 0;
  const startRaw = (document.getElementById("t-start") as HTMLInputElement).value;

  // união das filas dos analistas atribuídos (o mesmo chamado aparece em várias filas com m2m)
  const dedup = new Map<number, Ticket>();
  for (const a of assignees) {
    for (const t of a.tickets) {
      if (!dedup.has(t.id)) dedup.set(t.id, t);
    }
  }
  const tickets: Ticket[] = [...dedup.values()]
    .map((t) => (t.id === editId ? { ...t, estimatedMinutes: est } : t))
    .filter((t) => t.status !== "COMPLETED");

  // ordem topológica da fila (dependências internas), depois prioridade/posição
  const idsSet = new Set(tickets.map((t) => t.id));
  const indeg = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const t of tickets) indeg.set(t.id, 0);
  for (const t of tickets) {
    const dep = t.dependsOnTicketId;
    if (dep && idsSet.has(dep)) {
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
      const arr = children.get(dep) ?? [];
      arr.push(t.id);
      children.set(dep, arr);
    }
  }
  const base = [...tickets].sort((x, y) => x.priority - y.priority || x.position - y.position || x.id - y.id);
  const ordered: Ticket[] = [];
  const placed = new Set<number>();
  while (ordered.length < base.length) {
    const next = base.find((t) => !placed.has(t.id) && indeg.get(t.id) === 0);
    if (!next) break;
    placed.add(next.id);
    ordered.push(next);
    for (const cid of children.get(next.id) ?? []) indeg.set(cid, (indeg.get(cid) ?? 1) - 1);
  }
  for (const t of base) if (!placed.has(t.id)) ordered.push(t);

  const dueBy = new Map<number, Date>();
  let cursor = new Date();
  for (const t of ordered) {
    let start = cursor;
    if (t.dependsOnTicketId && dueBy.has(t.dependsOnTicketId)) {
      const depDue = dueBy.get(t.dependsOnTicketId)!;
      if (depDue.getTime() > start.getTime()) start = depDue;
    }
    if (t.id === editId && startRaw) {
      const parsed = new Date(startRaw);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > start.getTime()) start = parsed;
    } else if (t.startDate && (t.manualDates || t.status !== "BACKLOG")) {
      const sd = new Date(t.startDate);
      if (!Number.isNaN(sd.getTime()) && sd.getTime() > start.getTime()) start = sd;
    }
    const effectiveEst = t.id === editId ? est : t.estimatedMinutes;
    const remaining = Math.max(effectiveEst - (t.workedMinutes || 0), 0);
    const due = remaining > 0
      ? (assignees.length === 1 ? allocateMinutes(assignees[0], start, remaining) : allocateTeam(assignees, start, remaining))
      : start;
    if (!due) return null;
    dueBy.set(t.id, due);
    cursor = due;
    if (t.id === editId) return due;
  }
  return null;
}

function renderEta(): void {
  const el = document.getElementById("t-eta");
  if (!el) return;
  el.classList.remove("late");
  const eta = estimateEta();
  const dueRaw = (document.getElementById("t-due") as HTMLInputElement).value;
  const due = dueRaw ? new Date(dueRaw) : null;
  if (!eta) {
    el.textContent = "—";
    el.removeAttribute("title");
    return;
  }
  const late = !!due && !Number.isNaN(due.getTime()) && eta.getTime() > due.getTime();
  if (late) el.classList.add("late");
  el.textContent = `${fmtDay(eta)} ${fmtTime(eta)}` + (late ? " · atrasado" : "");
  el.title = late ? "O término estimado está depois da data prevista" : "Término estimado para a fila atual";
}

export async function saveTicket(): Promise<void> {
  const editId = (document.getElementById("t-save") as HTMLButtonElement).dataset.id;
  const status = (document.getElementById("t-status") as HTMLSelectElement).value;
  const iso = (raw: string): string | null => (raw ? new Date(raw).toISOString() : null);
  const startIso = iso((document.getElementById("t-start") as HTMLInputElement).value);
  const dueIso = iso((document.getElementById("t-due") as HTMLInputElement).value);
  const completedIso = iso((document.getElementById("t-completed") as HTMLInputElement).value);
  const title = (document.getElementById("t-title") as HTMLInputElement).value.trim();
  const estimatedMinutes = Number((document.getElementById("t-minutes") as HTMLInputElement).value);
  const analystIds = getAssigneeIds();
  const payload: Record<string, unknown> = {
    title,
    categoryId: Number((document.getElementById("t-category") as HTMLSelectElement).value),
    analystIds,
    priority: Number((document.getElementById("t-priority") as HTMLSelectElement).value || 3),
    estimatedMinutes,
    status,
    dependsOnTicketId: (document.getElementById("t-depends") as HTMLSelectElement).value || null,
  };
  if (startIso || dueIso) {
    payload.startDate = startIso;
    payload.dueDate = dueIso;
    payload.manualDates = true;
  }
  if (status === "COMPLETED") payload.completedAt = completedIso ?? new Date().toISOString();
  if (!title) throw new Error("Informe o título");
  if (!estimatedMinutes || estimatedMinutes <= 0) throw new Error("Estimativa deve ser maior que zero");
  const btn = document.getElementById("t-save") as HTMLButtonElement;
  btn.disabled = true;
  try {
    if (editId) await api(`/tickets/${editId}`, "PATCH", payload);
    else await api("/tickets", "POST", payload);
    showToast(editId ? "Chamado atualizado" : "Chamado criado");
    closeModal("ticketModal");
  } finally {
    btn.disabled = false;
  }
  await reloadAfterMutation({ refToToday: false });
  refreshTicketsModal();
}

export function openTicketModal(ticketId: number | null, analystId: number | null): void {
  let ticket: Ticket | null = null;
  if (ticketId) {
    const found = findTicket(ticketId);
    if (found) ticket = found;
  }
  document.getElementById("ticketModalTitle")!.textContent = ticket ? "Editar chamado #" + ticket.id : "Novo chamado";
  (document.getElementById("t-title") as HTMLInputElement).value = ticket ? ticket.title : "";
  (document.getElementById("t-minutes") as HTMLInputElement).value = ticket ? String(ticket.estimatedMinutes) : "60";
  (document.getElementById("t-start") as HTMLInputElement).value = toLocalInput(ticket?.startDate ?? null);
  (document.getElementById("t-due") as HTMLInputElement).value = toLocalInput(ticket?.dueDate ?? null);
  (document.getElementById("t-completed") as HTMLInputElement).value = toLocalInput(ticket?.completedAt ?? null);
  const save = document.getElementById("t-save") as HTMLButtonElement;
  save.dataset.id = ticket ? String(ticket.id) : "";
  fillTicketSelects(ticket, ticket ? null : analystId);
  if (ticket) {
    (document.getElementById("t-category") as HTMLSelectElement).value = String(ticket.categoryId);
    (document.getElementById("t-priority") as HTMLSelectElement).value = String(ticket.priority);
    fillDependsSelect(ticket);
  } else {
    (document.getElementById("t-priority") as HTMLSelectElement).value = "3";
  }
  for (const id of ["t-category", "t-priority", "t-status", "t-depends"]) {
    syncCustomSelect(document.getElementById(id) as HTMLSelectElement);
  }
  syncCompletedField();
  renderEta();
  openModal("ticketModal");
}

export function wireTicketModal(): void {
  for (const id of ["t-category", "t-priority", "t-status", "t-depends"]) {
    enhanceSelect(document.getElementById(id) as HTMLSelectElement);
  }
  (document.getElementById("t-status") as HTMLSelectElement).addEventListener("change", () => {
    syncCompletedField();
    renderEta();
  });

  document.getElementById("t-save")?.addEventListener("click", () =>
    saveTicket().catch((e: Error) => showToast("Erro: " + e.message))
  );

  const etaTriggers = ["t-minutes", "t-start", "t-due", "t-depends"];
  for (const id of etaTriggers) {
    document.getElementById(id)?.addEventListener("change", renderEta);
  }
  document.getElementById("t-assignees")?.addEventListener("change", () => {
    fillDependsSelect(null);
    renderEta();
  });
}