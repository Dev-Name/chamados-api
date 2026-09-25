import type { Filters, Ticket } from "../core/state";
import { basePriColor, statusColor, statusLabel, store } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import { avatarHtml } from "../core/analysts";
import { DEFAULT_FILTERS, categoriesFromTickets, fillSelectFromPairs, isAll, matchesFilters } from "../core/filters";
import { esc, fmtDay, fmtNum, fmtTime, getCleanName } from "../core/format";
import { allTickets, isOverdue } from "../core/tickets";
import { openModal, showToast } from "./chrome";
import { openTicketModal } from "./modals-ticket";

const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

let tf: Filters = { ...DEFAULT_FILTERS };

function matches(t: Ticket): boolean {
  if (!matchesFilters(t, tf)) return false;
  if (!isAll(tf.analyst)) {
    const aid = Number(tf.analyst);
    if (!(t.analystId === aid || (t.analystIds ?? []).includes(aid))) return false;
  }
  return true;
}

/** Preenche os selects da barra de filtros da listagem de chamados. */
function fillTicketFilterSelects(): void {
  const opts: Array<[string, Array<[string, string]>]> = [
    ["t-f-analyst", [["", "Todos os analistas"], ...store.analysts.map((a) => [String(a.id), getCleanName(a.name)] as [string, string])]],
    ["t-f-category", [["0", "Todas as categorias"], ...categoriesFromTickets().map((c) => [String(c.id), c.name] as [string, string])]],
    ["t-f-status", [["", "Todos os status"], ...Object.entries(statusLabel) as Array<[string, string]>]],
    ["t-f-priority", [["", "Todas as prioridades"], ...[1, 2, 3, 4, 5].map((p) => [String(p), "P" + p] as [string, string])]],
  ];
  const current: Record<string, string> = { "t-f-analyst": tf.analyst, "t-f-category": tf.category, "t-f-status": tf.status, "t-f-priority": tf.priority };
  for (const [id, pairs] of opts) {
    fillSelectFromPairs(id, pairs, current[id]);
  }
  const q = document.getElementById("t-f-q") as HTMLInputElement | null;
  if (q && q.value !== tf.q) q.value = tf.q;
}

export function renderTicketsList(): void {
  const list = document.getElementById("ticketsList");
  if (!list) return;
  fillTicketFilterSelects();
  const tickets = allTickets().sort((x, y) => x.priority - y.priority || x.id - y.id);
  if (tickets.length === 0) {
    list.innerHTML = '<div class="empty">Nenhum chamado ainda. Crie o primeiro com "+ Novo chamado".</div>';
    return;
  }
  const shown = tickets.filter(matches);
  if (shown.length === 0) {
    list.innerHTML = '<div class="empty">Nenhum chamado corresponde aos filtros.</div>';
    return;
  }
  list.innerHTML = "";
  for (const t of shown) {
    const prc = basePriColor[t.priority] || "#9aa4b2";
    const stc = statusColor[t.status] || "#94a3b8";
    const late = isOverdue(t);
    const dueLabel = t.dueDate ? `${fmtDay(new Date(t.dueDate))} ${fmtTime(t.dueDate)}` : "—";
    const ids = [...(t.analystIds ?? [])];
    if (t.analystId != null && !ids.includes(t.analystId)) ids.unshift(t.analystId);
    const assignees = ids
      .map((id) => store.analysts.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => !!a);
    const owner = store.analysts.find((a) => a.id === t.analystId) ?? null;
    const teamAvatars = assignees
      .map((a, i) => `<span class="stack" style="z-index:${100 - i}">${avatarHtml(a, 22)}</span>`)
      .join("");
    const teamNames = assignees.length ? assignees.map((a) => a.name).join(", ") : "— sem analistas —";

    const card = document.createElement("div");
    card.className = "ticket-card" + (late ? " late" : "");
    card.innerHTML = `
      <div class="t-card-head">
        <span class="t-card-title">${esc(t.title)} <span class="t-id">#${t.id}</span></span>
        <div class="t-card-badges">
          <span class="t-st" style="--stc:${stc}">${statusLabel[t.status] || t.status}</span>
          <span class="t-pri" style="--prc:${prc}">P${t.priority}</span>
          ${late ? `<span class="a-badge inact">Atrasado</span>` : ""}
        </div>
      </div>
      <div class="t-card-team">
        <div class="t-avatars">${teamAvatars || '<span class="t-avatars-empty">—</span>'}</div>
        <span class="t-team-lbl">${esc(owner ? "Responsável: " + owner.name : "Sem responsável")}</span>
      </div>
      <div class="t-card-meta">
        <span>Categoria: <b>${esc(t.category.name)}</b></span>
        <span>Tempo previsto: <b>${fmtNum(t.estimatedMinutes)}</b></span>
        <span class="${late ? "t-late" : ""}">Prazo: <b>${dueLabel}</b></span>
      </div>
      <div class="t-card-foot">
        <span class="t-card-team-nm" title="${esc(teamNames)}">${esc(teamNames)}</span>
        <div class="t-card-actions">
          <button class="ghost sm" data-t-edit="${t.id}" title="Editar chamado">Editar</button>
          <button type="button" class="icon-btn danger" data-t-del="${t.id}" title="Excluir chamado">${ICON_TRASH}</button>
        </div>
      </div>`;
    list.appendChild(card);
  }
}

export function refreshTicketsModal(): void {
  const modal = document.getElementById("ticketsModal");
  if (modal && modal.classList.contains("open")) renderTicketsList();
}

export function openTicketsModal(): void {
  renderTicketsList();
  openModal("ticketsModal");
}

async function removeTicket(id: number): Promise<void> {
  if (!window.confirm("Excluir o chamado #" + id + "?")) return;
  try {
    await api(`/tickets/${id}`, "DELETE");
    showToast("Chamado #" + id + " excluído");
    await reloadAfterMutation();
    refreshTicketsModal();
  } catch (err) {
    showToast("Erro: " + (err as Error).message);
  }
}

let qDebounce: ReturnType<typeof setTimeout> | undefined;

function wireTicketFilters(): void {
  const selMap = [
    ["t-f-analyst", "analyst"],
    ["t-f-category", "category"],
    ["t-f-status", "status"],
    ["t-f-priority", "priority"],
  ] as const;
  for (const [id, key] of selMap) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      tf[key] = v === "ALL" ? "" : v;
      renderTicketsList();
    });
  }
  const q = document.getElementById("t-f-q") as HTMLInputElement | null;
  q?.addEventListener("input", () => {
    tf.q = q.value;
    clearTimeout(qDebounce);
    qDebounce = setTimeout(renderTicketsList, 150);
  });
  document.getElementById("t-f-clear")?.addEventListener("click", () => {
    tf = { ...DEFAULT_FILTERS };
    renderTicketsList();
  });
}

export function wireTicketsModal(): void {
  wireTicketFilters();
  document.getElementById("ticketsMenu")?.addEventListener("click", openTicketsModal);
  document.getElementById("t-add")?.addEventListener("click", () => openTicketModal(null, null));
  const list = document.getElementById("ticketsList");
  list?.addEventListener("click", (e) => {
    const del = (e.target as HTMLElement).closest<HTMLElement>("[data-t-del]");
    if (del) {
      void removeTicket(Number(del.dataset.tDel));
      return;
    }
    const edit = (e.target as HTMLElement).closest<HTMLElement>("[data-t-edit]");
    if (edit) openTicketModal(Number(edit.dataset.tEdit), null);
  });
}