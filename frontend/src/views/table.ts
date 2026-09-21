import { store, statusLabel, STATUS_FLOW, statusColor, basePriColor } from "../core/state";
import type { Ticket } from "../core/state";
import { visibleAnalysts, visibleTicket } from "../core/filters";
import { api, reloadAfterMutation } from "../core/api";
import { avatarHtml } from "../core/analysts";
import { esc, fmtNum, fmtTime } from "../core/format";
import { openTicketModal } from "../ui/modals-ticket";
import { showToast } from "../ui/chrome";

type SortKey = "id" | "title" | "category" | "analyst" | "priority" | "status" | "estimatedMinutes" | "startDate" | "dueDate" | "workedMinutes";

const sortState: { key: SortKey; dir: 1 | -1 } = { key: "priority", dir: 1 };

function tableTickets(): Ticket[] {
  const out: Ticket[] = [];
  for (const a of visibleAnalysts()) out.push(...a.tickets);
  return out.filter(visibleTicket);
}

export function renderTable(): void {
  const el = document.getElementById("viewContainer")!;
  const tickets = tableTickets();

  let html = `<div class="tb-toolbar">
      <span class="tb-count">${tickets.length} chamado(s)</span>
      <div class="tb-bulk" id="tbBulk" hidden>
        <span class="tb-sel" id="tbSelLabel">0 selecionados</span>
        <select id="tbBulkStatus"><option value="">Status…</option>${STATUS_FLOW.map((s) => `<option value="${s}">${statusLabel[s]}</option>`).join("")}</select>
        <select id="tbBulkPriority"><option value="">Prioridade…</option>${[1, 2, 3, 4, 5].map((p) => `<option value="${p}">P${p}</option>`).join("")}</select>
        <select id="tbBulkAnalyst"><option value="">Analista…</option>${store.analysts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
        <button id="tbBulkApply" class="btn subtle">Aplicar</button>
        <button id="tbBulkClear" class="btn subtle">Limpar</button>
      </div>
      <button id="tbCsv" class="btn subtle" title="Exporta a tabela para CSV">Exportar CSV</button>
      <button id="tbFirst" class="btn subtle" title="Cria um novo chamado">+ Novo chamado</button>
    </div>`;

  html += `<div class="tb-scroll"><table class="tb">
    <thead><tr>
      <th class="tb-check"><input type="checkbox" id="tbAll" title="Selecionar todos"></th>
      ${th("id", "ID")}
      ${th("title", "Chamado")}
      ${th("category", "Categoria")}
      ${th("analyst", "Analista")}
      ${th("priority", "Prioridade")}
      ${th("status", "Status")}
      ${th("estimatedMinutes", "Previsto")}
      ${th("workedMinutes", "Trabalhado")}
      ${th("startDate", "Início")}
      ${th("dueDate", "Fim")}
      <th>Dep</th>
      <th class="tb-blank"></th>
    </tr></thead><tbody>`;

  const sorted = [...tickets].sort((x, y) => {
    const a = x, b = y;
    let r = 0;
    switch (sortState.key) {
      case "id": r = a.id - b.id; break;
      case "title": r = a.title.localeCompare(b.title); break;
      case "category": r = a.category.name.localeCompare(b.category.name); break;
      case "analyst": {
        const nameA = store.analysts.find((x) => x.id === a.analystId)?.name ?? "";
        const nameB = store.analysts.find((x) => x.id === b.analystId)?.name ?? "";
        r = nameA.localeCompare(nameB, "pt-BR");
        break;
      }
      case "priority": r = a.priority - b.priority; break;
      case "status": r = a.status.localeCompare(b.status); break;
      case "estimatedMinutes": r = a.estimatedMinutes - b.estimatedMinutes; break;
      case "workedMinutes": r = a.workedMinutes - b.workedMinutes; break;
      case "startDate": r = (a.startDate || "").localeCompare(b.startDate || ""); break;
      case "dueDate": r = (a.dueDate || "").localeCompare(b.dueDate || ""); break;
    }
    return r * sortState.dir;
  });

let rows = "";
  for (const t of sorted) {
    const analyst = store.analysts.find((a) => a.id === t.analystId);
    const prc = basePriColor[t.priority] || "#9aa4b2";
    const stc = statusColor[t.status] || "#94a3b8";
    rows += `<tr data-id="${t.id}" data-status="${t.status}" data-priority="${t.priority}" data-aid="${t.analystId ?? ""}">
      <td class="tb-check"><input type="checkbox" class="tb-selbox" value="${t.id}"></td>
      <td class="tb-id">#${t.id}</td>
      <td class="tb-title" title="${esc(t.title)}">${esc(t.title)}</td>
      <td>${esc(t.category.name)}</td>
      <td class="tb-analyst" data-col="analyst">${analyst ? avatarHtml(analyst, 16) + esc(analyst.name) : '<span class="muted">—</span>'}</td>
      <td data-col="priority"><span class="bt-pill" style="--prc:${prc}">P${t.priority}</span></td>
      <td data-col="status"><span class="st-badge" style="--stc:${stc}">${statusLabel[t.status] || t.status}</span></td>
      <td>${fmtNum(t.estimatedMinutes)}</td>
      <td>${t.workedMinutes ? fmtNum(t.workedMinutes) : "—"}</td>
      <td>${t.startDate ? fmtTime(t.startDate) : "—"}</td>
      <td>${t.dueDate ? fmtTime(t.dueDate) : "—"}</td>
      <td>${t.dependsOn ? `#${t.dependsOn.id}` : t.dependsOnTicketId ? `#${t.dependsOnTicketId}` : "—"}</td>
      <td class="tb-edit"><button class="btn subtle tb-pen" title="Editar">✎</button></td>
    </tr>`;
  }
  if (!rows) rows = '<tr><td colspan="13" class="tb-empty">Nenhum chamado com os filtros atuais.</td></tr>';
  html += rows + "</tbody></table></div>";
  el.innerHTML = html;
  wireTable(sorted);
}

function th(key: SortKey, label: string): string {
  const arrow = sortState.key === key ? (sortState.dir === 1 ? "▲" : "▼") : "";
  return `<th data-sort="${key}" class="tb-sort" title="Ordenar por ${label}">${label} ${arrow}</th>`;
}

function wireTable(rows: Ticket[]): void {
  const el = document.getElementById("viewContainer")!;

  el.querySelectorAll<HTMLElement>(".tb-sort").forEach((t) =>
    t.addEventListener("click", () => {
      const key = t.dataset.sort as SortKey;
      if (sortState.key === key) sortState.dir = (sortState.dir === 1 ? -1 : 1) as 1 | -1;
      else {
        sortState.key = key;
        sortState.dir = 1;
      }
      renderTable();
    })
  );

  el.querySelector("#tbFirst")?.addEventListener("click", () => openTicketModal(null, null));

  el.querySelector("#tbCsv")?.addEventListener("click", exportCsv);

  const all = el.querySelector<HTMLInputElement>("#tbAll");
  const boxes = () => [...el.querySelectorAll<HTMLInputElement>(".tb-selbox")];
  const syncBulk = () => {
    const sel = boxes().filter((b) => b.checked);
    const bulk = el.querySelector<HTMLElement>("#tbBulk")!;
    bulk.hidden = sel.length === 0;
    el.querySelector("#tbSelLabel")!.textContent = sel.length + " selecionados";
    if (all) all.checked = boxes().length > 0 && sel.length === boxes().length;
  };
  boxes().forEach((b) => b.addEventListener("change", syncBulk));
  all?.addEventListener("change", () => {
    boxes().forEach((b) => (b.checked = all.checked));
    syncBulk();
  });

  el.querySelector("#tbBulkClear")?.addEventListener("click", () => {
    boxes().forEach((b) => (b.checked = false));
    syncBulk();
  });

  el.querySelector("#tbBulkApply")?.addEventListener("click", async () => {
    const status = (el.querySelector<HTMLSelectElement>("#tbBulkStatus")!).value;
    const priority = (el.querySelector<HTMLSelectElement>("#tbBulkPriority")!).value;
    const analyst = (el.querySelector<HTMLSelectElement>("#tbBulkAnalyst")!).value;
    const ids = boxes().filter((b) => b.checked).map((b) => Number(b.value));
    if (!ids.length) return;
    let done = 0;
    for (const id of ids) {
      const body: Record<string, unknown> = {};
      if (status) body.status = status;
      if (priority !== "") body.priority = Number(priority);
      if (analyst !== "") body.analystId = Number(analyst);
      if (!Object.keys(body).length) continue;
      try {
        await api(`/tickets/${id}`, "PATCH", body);
        done++;
      } catch {
        /* skip failed */
      }
    }
    if (done) {
      showToast(done + " chamado(s) atualizado(s)");
      await reloadAfterMutation();
    }
    boxes().forEach((b) => (b.checked = false));
    syncBulk();
  });

  const body = el.querySelector<HTMLElement>("tbody")!;
  body.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
    if (!tr) return;
    if ((e.target as HTMLElement).classList.contains("tb-pen")) {
      openTicketModal(Number(tr.dataset.id), null);
      return;
    }
    if ((e.target as HTMLElement).classList.contains("tb-selbox")) return;
    openTicketModal(Number(tr.dataset.id), null);
  });

  // inline editing of status / priority / analyst via dblclick on those cells
  body.addEventListener("dblclick", (e) => inlineEdit(e, rows));
}

function inlineEdit(e: MouseEvent, rows: Ticket[]): void {
  const cell = (e.target as HTMLElement).closest<HTMLElement>("td[data-col]");
  const tr = cell?.closest<HTMLElement>("tr[data-id]");
  if (!cell || !tr) return;
  const id = Number(tr.dataset.id);
  const t = rows.find((x) => x.id === id);
  if (!t) return;
  const col = cell.dataset.col;
  if (col === "status") {
    const select = document.createElement("select");
    select.innerHTML = STATUS_FLOW.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${statusLabel[s]}</option>`).join("");
    select.className = "tb-inline";
    cell.replaceChildren(select);
    select.focus();
    select.addEventListener("change", async () => {
      try {
        await api(`/tickets/${id}`, "PATCH", { status: select.value });
        await reloadAfterMutation();
      } catch (err) {
        showToast("Erro: " + (err as Error).message);
        await reloadAfterMutation();
      }
    });
    select.addEventListener("blur", () => renderTable());
    e.preventDefault();
  } else if (col === "priority") {
    const select = document.createElement("select");
    select.innerHTML = [5, 4, 3, 2, 1].map((p) => `<option value="${p}" ${p === t.priority ? "selected" : ""}>P${p}</option>`).join("");
    select.className = "tb-inline";
    cell.replaceChildren(select);
    select.focus();
    select.addEventListener("change", async () => {
      try {
        await api(`/tickets/${t.id}`, "PATCH", { priority: Number(select.value) });
        await reloadAfterMutation();
      } catch (err) {
        showToast("Erro: " + (err as Error).message);
        await reloadAfterMutation();
      }
    });
    select.addEventListener("blur", () => renderTable());
    e.preventDefault();
  } else if (col === "analyst") {
    const select = document.createElement("select");
    select.innerHTML = `<option value="-1">— sem analista —</option>` + store.analysts.map((a) => `<option value="${a.id}" ${a.id === t.analystId ? "selected" : ""}>${esc(a.name)}</option>`).join("");
    select.className = "tb-inline";
    cell.replaceChildren(select);
    select.focus();
    select.addEventListener("change", async () => {
      const v = select.value === "-1" ? null : Number(select.value);
      try {
        await api(`/tickets/${t.id}`, "PATCH", { analystId: v });
        await reloadAfterMutation();
      } catch (err) {
        showToast("Erro: " + (err as Error).message);
        await reloadAfterMutation();
      }
    });
    select.addEventListener("blur", () => renderTable());
    e.preventDefault();
  }
}

function exportCsv(): void {
  const rows = tableTickets();
  const header = ["ID", "Título", "Categoria", "Analista", "Prioridade", "Status", "Previsto (min)", "Trabalhado (min)", "Início", "Fim", "Depende de"];
  const lines = rows.map((t) => {
    const a = store.analysts.find((x) => x.id === t.analystId);
    return [
      t.id,
      t.title,
      t.category.name,
      a ? a.name : "",
      t.priority,
      statusLabel[t.status] || t.status,
      t.estimatedMinutes,
      t.workedMinutes,
      t.startDate ? fmtTime(t.startDate) : "",
      t.dueDate ? fmtTime(t.dueDate) : "",
      t.dependsOn ? t.dependsOn.id : t.dependsOnTicketId ?? "",
    ]
      .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
      .join(";");
  });
  const csv = "\uFEFF" + [header.join(";"), ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chamados-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("CSV exportado");
}