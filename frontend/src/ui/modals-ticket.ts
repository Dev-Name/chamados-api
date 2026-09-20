import type { Ticket } from "../core/state";
import { statusLabel, store } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import { categoriesFromTickets } from "../core/filters";
import { fmtDay } from "../core/format";
import { closeModal, openModal, showToast } from "./chrome";

function refreshRemain(): void {
  const est = Number((document.getElementById("t-minutes") as HTMLInputElement).value) || 0;
  const worked = Number((document.getElementById("t-worked") as HTMLInputElement).value) || 0;
  (document.getElementById("t-remain") as HTMLInputElement).value = String(Math.max(est - worked, 0));
}

export function findTicket(id: number): { analystId: number | null; ticket: Ticket } | null {
  for (const a of store.analysts) {
    const found = a.tickets.find((t) => t.id === id);
    if (found) return { analystId: a.id, ticket: found };
  }
  return null;
}

function fillDependsSelect(editTicket: Ticket | null, preserve: string | null = null): void {
  const depSel = document.getElementById("t-depends") as HTMLSelectElement;
  const current = preserve ?? depSel.value;
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
}

function fillTicketSelects(editTicket: Ticket | null): void {
  const catSel = document.getElementById("t-category") as HTMLSelectElement;
  catSel.innerHTML = "";
  const cats = store.categories.length ? store.categories : categoriesFromTickets();
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = String(c.id);
    o.textContent = c.name;
    if (editTicket && editTicket.categoryId === c.id) o.selected = true;
    catSel.appendChild(o);
  }
  const anaSel = document.getElementById("t-analyst") as HTMLSelectElement;
  anaSel.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "— sem analista —";
  if (editTicket && !editTicket.analystId) noneOpt.selected = true;
  anaSel.appendChild(noneOpt);
  for (const a of store.analysts) {
    const o = document.createElement("option");
    o.value = String(a.id);
    o.textContent = a.name;
    if (editTicket && editTicket.analystId === a.id) o.selected = true;
    anaSel.appendChild(o);
  }
  const priSel = document.getElementById("t-priority") as HTMLSelectElement;
  priSel.innerHTML = "";
  for (let p = 1; p <= 5; p++) {
    const o = document.createElement("option");
    o.value = String(p);
    o.textContent = "P" + p + (p === 1 ? " (urgente)" : "");
    if (editTicket && editTicket.priority === p) o.selected = true;
    priSel.appendChild(o);
  }
  const stSel = document.getElementById("t-status") as HTMLSelectElement;
  stSel.innerHTML = "";
  for (const [k, v] of Object.entries(statusLabel)) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = v;
    if (editTicket && editTicket.status === k) o.selected = true;
    stSel.appendChild(o);
  }
  (document.getElementById("t-newcat") as HTMLInputElement).value = "";
  fillDependsSelect(editTicket);
}

export async function saveTicket(): Promise<void> {
  const editId = (document.getElementById("t-save") as HTMLButtonElement).dataset.id;
  const newcat = (document.getElementById("t-newcat") as HTMLInputElement).value.trim();
  let categoryId = Number((document.getElementById("t-category") as HTMLSelectElement).value);
  if (newcat && !categoryId) {
    const cat = await api<{ id: number }>("/categories", "POST", { name: newcat });
    categoryId = cat.id;
  }
  const payload = {
    title: (document.getElementById("t-title") as HTMLInputElement).value.trim(),
    categoryId,
    analystId: (document.getElementById("t-analyst") as HTMLSelectElement).value || null,
    priority: Number((document.getElementById("t-priority") as HTMLSelectElement).value || 3),
    estimatedMinutes: Number((document.getElementById("t-minutes") as HTMLInputElement).value),
    workedMinutes: Number((document.getElementById("t-worked") as HTMLInputElement).value) || 0,
    status: (document.getElementById("t-status") as HTMLSelectElement).value,
    dependsOnTicketId: (document.getElementById("t-depends") as HTMLSelectElement).value || null,
  };
  if (!payload.title) throw new Error("Informe o título");
  if (!payload.estimatedMinutes || payload.estimatedMinutes <= 0) throw new Error("Estimativa deve ser maior que zero");
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
}

export function openTicketModal(ticketId: number | null, analystId: number | null): void {
  let ticket: Ticket | null = null;
  if (ticketId) {
    const found = findTicket(ticketId);
    if (found) ticket = found.ticket;
  }
  document.getElementById("ticketModalTitle")!.textContent = ticket ? "Editar chamado #" + ticket.id : "Novo chamado";
  (document.getElementById("t-title") as HTMLInputElement).value = ticket ? ticket.title : "";
  (document.getElementById("t-minutes") as HTMLInputElement).value = ticket ? String(ticket.estimatedMinutes) : "60";
  (document.getElementById("t-worked") as HTMLInputElement).value = ticket ? String(ticket.workedMinutes || 0) : "0";
  refreshRemain();
  const save = document.getElementById("t-save") as HTMLButtonElement;
  save.dataset.id = ticket ? String(ticket.id) : "";
  const del = document.getElementById("t-delete") as HTMLButtonElement;
  del.hidden = !ticket;
  if (ticket) del.dataset.id = String(ticket.id);
  fillTicketSelects(ticket);
  if (ticket) {
    (document.getElementById("t-category") as HTMLSelectElement).value = String(ticket.categoryId);
    (document.getElementById("t-analyst") as HTMLSelectElement).value = ticket.analystId ? String(ticket.analystId) : "";
    (document.getElementById("t-priority") as HTMLSelectElement).value = String(ticket.priority);
    fillDependsSelect(ticket);
  } else {
    (document.getElementById("t-priority") as HTMLSelectElement).value = "3";
    if (analystId) (document.getElementById("t-analyst") as HTMLSelectElement).value = String(analystId);
  }
  openModal("ticketModal");
}

export function wireTicketModal(): void {
  document.getElementById("newTicket")?.addEventListener("click", () => openTicketModal(null, null));

  (document.getElementById("t-minutes") as HTMLInputElement).addEventListener("input", refreshRemain);
  (document.getElementById("t-worked") as HTMLInputElement).addEventListener("input", refreshRemain);

  document.getElementById("t-save")?.addEventListener("click", () =>
    saveTicket().catch((e: Error) => showToast("Erro: " + e.message))
  );

  (document.getElementById("t-analyst") as HTMLSelectElement).addEventListener("change", () => fillDependsSelect(null));

  document.getElementById("t-delete")?.addEventListener("click", async () => {
    const id = Number((document.getElementById("t-delete") as HTMLButtonElement).dataset.id);
    try {
      await api(`/tickets/${id}`, "DELETE");
      showToast("Chamado excluído");
      closeModal("ticketModal");
      await reloadAfterMutation();
    } catch (e) {
      showToast("Erro: " + (e as Error).message);
    }
  });
}