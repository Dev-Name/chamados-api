import { store, statusLabel, statusColor, STATUS_FLOW, emit } from "../core/state";
import type { Analyst, Ticket } from "../core/state";
import { visibleAnalysts, visibleTicket } from "../core/filters";
import { priorityColor, isOverdue } from "../core/tickets";
import { api, reloadAfterMutation } from "../core/api";
import { avatarHtml } from "../core/analysts";
import { esc, fmtNum, fmtTime } from "../core/format";
import { openTicketModal } from "../ui/modals-ticket";
import { showToast } from "../ui/chrome";

function allKanbanTickets(): Array<{ t: Ticket; a: Analyst }> {
  const out: Array<{ t: Ticket; a: Analyst }> = [];
  for (const a of visibleAnalysts()) {
    for (const t of a.tickets) {
      if (t.status !== "COMPLETED" && visibleTicket(t)) out.push({ t, a });
    }
  }
  return out;
}

function cardHtml(t: Ticket, a: Analyst): string {
  const prc = priorityColor(t.priority);
  const late = isOverdue(t);
  const dep = t.dependsOnTicketId != null ? "⛓" : "";
  const tooltip =
    `#${t.id} ${t.title}\n${t.category.name} • ${statusLabel[t.status] || t.status}${late ? " • ATRASADO" : ""}\n` +
    `analista: ${a.name}\nestimado: ${fmtNum(t.estimatedMinutes)} min${t.workedMinutes ? " • trabalhado: " + fmtNum(t.workedMinutes) : ""}` +
    (t.startDate ? `\n${fmtTime(t.startDate)} → ${fmtTime(t.dueDate)}` : "");
  return `<article class="kb-card${late ? " late" : ""}" draggable="true" data-id="${t.id}" data-aid="${a.id}" title="${esc(tooltip)}">
    <div class="kb-card-top">
      <span class="kb-title">#${t.id} ${esc(t.title)}</span>
      <span class="bt-pill" style="--prc:${prc}">P${t.priority}</span>
    </div>
    <div class="kb-card-meta">
      <span class="kb-cat" title="${esc(t.category.name)}">${esc(t.category.name)}</span>
      <span class="kb-analyst" title="${esc(a.name)}">${avatarHtml(a, 14)}<span class="kb-a-name">${esc(a.name.split(" ")[0])}</span></span>
      <span class="kb-ext">${fmtNum(t.estimatedMinutes)}min</span>
      ${dep ? '<span class="kb-dep" title="Possui dependências">⛓</span>' : ""}
      ${late ? '<span class="kb-alert" title="Atrasado">!</span>' : ""}
    </div>
  </article>`;
}

export function renderKanban(): void {
  const el = document.getElementById("viewContainer")!;
  let html = `<div class="kb-toolbar">
      <label class="kb-swim" title="Agrupa o quadro por analista">
        <input type="checkbox" id="kbSwimTgl" ${store.kanbanSwimlanes ? "checked" : ""}>
        <span>Nadar por analista</span>
      </label>
      <span class="kb-hint">Arraste os chamados entre colunas para mudar o status.</span>
    </div>`;

  if (store.kanbanSwimlanes) {
    for (const a of visibleAnalysts()) {
      const items = a.tickets.filter((t) => t.status !== "COMPLETED" && visibleTicket(t));
      html += `<section class="kb-lane" data-aid="${a.id}">
          <header class="kb-lane-head">${avatarHtml(a, 18)}<h3>${esc(a.name)}</h3><span class="kb-lane-count">${items.length}</span></header>
          ${boardHtml(a)}
        </section>`;
    }
  } else {
    html += boardHtml(null);
  }
  el.innerHTML = html;
  wireBoard();
  const swim = document.getElementById("kbSwimTgl") as HTMLInputElement | null;
  if (swim) {
    swim.addEventListener("change", () => {
      store.kanbanSwimlanes = swim.checked;
      emit();
    });
  }
}

function boardHtml(analyst: Analyst | null): string {
  const tickets: Array<{ t: Ticket; a: Analyst }> = analyst
    ? analyst.tickets
        .filter((t) => t.status !== "COMPLETED" && visibleTicket(t))
        .map((t) => ({ t, a: analyst }))
    : allKanbanTickets();
  let html = '<div class="kb-board">';
  for (const st of STATUS_FLOW) {
    const items = tickets.filter((x) => x.t.status === st);
    const bodyHtml = items.map((x) => cardHtml(x.t, x.a)).join("") || '<span class="kb-empty">sem chamados</span>';
    html += `<section class="kb-col" data-status="${st}">
        <header class="kb-col-head">
          <i style="background:${statusColor[st]}"></i>
          <span>${statusLabel[st] || st}</span>
          <b>${items.length}</b>
        </header>
        <div class="kb-col-body">
          ${bodyHtml}
        </div>
      </section>`;
  }
  html += "</div>";
  return html;
}

function wireBoard(): void {
  document.querySelectorAll<HTMLElement>(".kb-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.setData("text/plain", card.dataset.id || "");
        dt.effectAllowed = "move";
      }
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  document.querySelectorAll<HTMLElement>(".kb-col-body").forEach((body) => {
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      const col = body.closest<HTMLElement>(".kb-col")!;
      const cards = [...body.querySelectorAll<HTMLElement>(".kb-card")].filter((c) => !c.classList.contains("dragging"));
      const after = cards.find((c) => {
        const r = c.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      document.querySelectorAll(".kb-drop-dot").forEach((d) => d.remove());
      const dot = document.createElement("div");
      dot.className = "kb-drop-dot";
      if (after) body.insertBefore(dot, after);
      else body.appendChild(dot);
      col.classList.add("drag-over");
    });
    body.addEventListener("dragleave", (e) => {
      const col = body.closest<HTMLElement>(".kb-col")!;
      if (!col.contains(e.relatedTarget as Node)) col.classList.remove("drag-over");
    });
  });

  document.querySelectorAll<HTMLElement>(".kb-col").forEach((col) => {
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = Number((e as DragEvent).dataTransfer?.getData("text/plain"));
      if (!id) return;
      const status = col.dataset.status!;
      const dot = col.querySelector<HTMLElement>(".kb-drop-dot");
      const position = dot
        ? dot.previousElementSibling
          ? [...dot.parentElement!.children].indexOf(dot)
          : 0
        : Infinity;
      dot?.remove();
      const ticket = findAny(id);
      if (!ticket) return;
      try {
        const body: Record<string, unknown> = { status };
        if (Number.isFinite(position)) body.position = Math.max(position, 0);
        await api(`/tickets/${id}`, "PATCH", body);
        await reloadAfterMutation();
      } catch (err) {
        showToast("Erro: " + (err as Error).message);
        await reloadAfterMutation();
      }
    });
  });
}

function findAny(id: number): { t: Ticket; a: Analyst } | null {
  for (const x of allKanbanTickets()) if (x.t.id === id) return x;
  const a = store.analysts.find((x) => x.tickets.some((t) => t.id === id));
  if (a) {
    const t = a.tickets.find((x) => x.id === id);
    if (t) return { t, a };
  }
  return null;
}

export function wireKanbanClick(): void {
  const el = document.getElementById("viewContainer")!;
  el.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".kb-card");
    if (card) {
      openTicketModal(Number(card.dataset.id), null);
    }
  });
}