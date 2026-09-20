import type { Analyst } from "../core/state";
import { statusLabel, store } from "../core/state";
import { api, reloadAfterMutation } from "../core/api";
import { blockColor, sortedQueue } from "../core/tickets";
import { esc, fmtNum } from "../core/format";
import { closeModal, openModal, showToast } from "./chrome";

let pendingOrder = new Map<number, number[]>();
let queueModalAnalystId: number | null = null;

function orderedQueue(a: Analyst) {
  const order = pendingOrder.get(a.id);
  if (order && order.length) {
    return order.map((id) => a.tickets.find((t) => t.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  }
  return sortedQueue(a);
}

function renderQueueModal(): void {
  const a = store.analysts.find((x) => x.id === queueModalAnalystId);
  const body = document.getElementById("queueList")!;
  body.innerHTML = "";
  if (!a) return;
  document.getElementById("queueModalTitle")!.textContent = "Ordenar fila — " + a.name;
  const items = orderedQueue(a);
  items.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "queue-row";
    row.innerHTML = `
        <span class="pri-badge" style="background:${blockColor(t)}">${t.priority}</span>
        <span class="q-title">#${t.id} ${esc(t.title)}</span>
        <span class="q-status ${t.status}">${statusLabel[t.status] || t.status}</span>
        <span class="q-min">${fmtNum(t.estimatedMinutes)}</span>
        <div class="q-btns">
          <button class="ghost" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="ghost" data-move="${i}" data-dir="1" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
        </div>`;
    body.appendChild(row);
  });
  const total = items.reduce((s, t) => s + t.estimatedMinutes, 0);
  document.getElementById("queueHint")!.textContent =
    items.length + " chamados na fila • " + fmtNum(total) + " de trabalho previsto";
  body.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((b) =>
    b.addEventListener("click", () => moveQueueRow(Number(b.dataset.move), Number(b.dataset.dir)))
  );
}

function moveQueueRow(index: number, dir: number): void {
  const a = store.analysts.find((x) => x.id === queueModalAnalystId);
  if (!a) return;
  const current = orderedQueue(a);
  const target = index + dir;
  if (target < 0 || target >= current.length) return;
  const ids = current.map((t) => t.id);
  const tmp = ids[index];
  ids[index] = ids[target];
  ids[target] = tmp;
  pendingOrder.set(a.id, ids);
  renderQueueModal();
}

export function openQueueModal(id: number): void {
  queueModalAnalystId = id;
  pendingOrder.delete(id);
  renderQueueModal();
  openModal("queueModal");
}

export function wireQueueModal(): void {
  document.getElementById("queueSave")?.addEventListener("click", async () => {
    if (queueModalAnalystId == null) return;
    const ids = pendingOrder.get(queueModalAnalystId);
    if (!ids || !ids.length) {
      closeModal("queueModal");
      return;
    }
    try {
      await api(`/analysts/${queueModalAnalystId}/reorder`, "POST", { order: ids });
      showToast("Ordem salva e fila recalculada");
      pendingOrder.delete(queueModalAnalystId);
      closeModal("queueModal");
      await reloadAfterMutation();
    } catch (e) {
      showToast("Erro: " + (e as Error).message);
    }
  });
}