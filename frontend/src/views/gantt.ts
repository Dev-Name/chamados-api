import { store, statusColor, emit } from "../core/state";
import type { GanttScale, Ticket } from "../core/state";
import { visibleAnalysts, visibleTicket } from "../core/filters";
import { blockColor, isOverdue } from "../core/tickets";
import { avatarHtml, analystColor } from "../core/analysts";
import { esc, fmtNum, fmtTime, cap } from "../core/format";
import { ganttHorizonDays, ganttWindowStart } from "../core/nav";
import { openTicketModal } from "../ui/modals-ticket";

const PX: Record<GanttScale, number> = { day: 60, week: 26, month: 4 };
const LANE_PAD = 8;

interface GBar {
  t: Ticket;
  x: number;
  w: number;
  y: number;
  clipped: boolean;
}

function barH(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--d-bar");
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 22;
}

function numberOrNull(v: string | null): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function buildBars(): Array<{ a: typeof store.analysts[number]; bars: GBar[]; laneH: number }> {
  const ws = ganttWindowStart().getTime();
  const px = PX[store.ganttScale];
  const days = ganttHorizonDays();
  const we = ws + days * 86400000;
  const bh = barH();
  const out: Array<{ a: typeof store.analysts[number]; bars: GBar[]; laneH: number }> = [];

  for (const a of visibleAnalysts()) {
    const tickets = a.tickets.filter((t) => t.status !== "COMPLETED" && visibleTicket(t));
    const bars: GBar[] = [];
    for (const t of tickets) {
      const s = numberOrNull(t.startDate);
      const e = numberOrNull(t.dueDate);
      if (s == null || e == null) continue;
      const x = ((Math.max(s, ws) - ws) / 86400000) * px;
      const xe = ((Math.min(e, we) - ws) / 86400000) * px;
      if (xe < 0 || x > days * px) continue;
      bars.push({
        t,
        x: Math.max(x, 0),
        w: Math.max(xe - x, 4),
        y: 0,
        clipped: s < ws || e > we,
      });
    }
    // assign slots by greedy overlap
    const slots: GBar[][] = [];
    const byStart = [...bars].sort((p, q) => p.x - q.x);
    for (const b of byStart) {
      let placed = false;
      for (const slot of slots) {
        const last = slot[slot.length - 1];
        if (b.x >= last.x + last.w + 2) {
          slot.push(b);
          placed = true;
          break;
        }
      }
      if (!placed) slots.push([b]);
    }
    const laneH = Math.max(slots.length, 1) * (bh + 4) + LANE_PAD;
    const all = slots.flat();
    for (const b of all) {
      const si = slots.findIndex((s) => s.includes(b));
      b.y = LANE_PAD / 2 + si * (bh + 4) + 1;
    }
    out.push({ a, bars: all, laneH });
  }
  return out;
}

export function renderGantt(): void {
  const el = document.getElementById("viewContainer")!;
  const lanes = buildBars();
  const ws = ganttWindowStart();
  const px = PX[store.ganttScale];
  const days = ganttHorizonDays();
  const totalPx = days * px;
  const bh = barH();
  const now = new Date();
  const nowX = ((now.getTime() - ws.getTime()) / 86400000) * px;

  let html = `<div class="g-toolbar">
      <div class="g-scale" role="tablist" aria-label="Escala do Gantt">
        <button class="g-scale-btn${store.ganttScale === "day" ? " active" : ""}" data-scale="day" role="tab" aria-selected="${store.ganttScale === "day"}">Dia</button>
        <button class="g-scale-btn${store.ganttScale === "week" ? " active" : ""}" data-scale="week" role="tab" aria-selected="${store.ganttScale === "week"}">Semana</button>
        <button class="g-scale-btn${store.ganttScale === "month" ? " active" : ""}" data-scale="month" role="tab" aria-selected="${store.ganttScale === "month"}">Mês</button>
      </div>
      <span class="g-hint">Barras = chamado previsto. Setas = dependências. Barra vermelha = atrasado.</span>
    </div>`;

  const gutterW = 170;
  html += `<div class="g-scroll">
    <div class="g-gutter" style="width:${gutterW}px">`;
  for (const lane of lanes) {
    html += `<div class="g-lane-label" style="height:${lane.laneH}px">${avatarHtml(lane.a, 18)}<span class="ld-name" style="color:${analystColor(lane.a)}">${esc(lane.a.name)}</span></div>`;
  }
  html += "</div>";

  let top = 34;
  html += `<div class="g-body" style="width:${totalPx}px;min-width:${totalPx}px;height:${top}px">`;

  // header ticks
  html += '<div class="g-head" style="width:' + totalPx + "px\">";
  if (store.ganttScale === "day") {
    for (let i = 0; i < days; i++) {
      const d = new Date(ws.getTime() + i * 86400000);
      html += `<div class="g-tick week" style="left:${i * px}px;width:${px}px" title="${d.toLocaleDateString("pt-BR")}">${d.getDate()}</div>`;
    }
  } else if (store.ganttScale === "week") {
    for (let i = 0; i < days; i++) {
      const d = new Date(ws.getTime() + i * 86400000);
      html += `<div class="g-tick week" style="left:${i * px}px;width:${px}px" title="${d.toLocaleDateString("pt-BR")}">${d.getDate()}</div>`;
    }
  } else {
    let prevMonth = -1;
    for (let i = 0; i < days; i++) {
      const d = new Date(ws.getTime() + i * 86400000);
      if (d.getMonth() !== prevMonth) {
        prevMonth = d.getMonth();
        html += `<div class="g-tick month" style="left:${i * px}px;width:${px * 23}px" title="${d.toLocaleDateString("pt-BR")}">${cap(d.toLocaleDateString("pt-BR", { month: "short" }))}</div>`;
      }
    }
  }
  html += "</div>";
  const barPos = new Map<number, { x: number; y: number; w: number }>();
  for (const lane of lanes) {
    html += `<div class="g-lane" style="top:${top}px;height:${lane.laneH}px;width:${totalPx}px">`;
    for (const b of lane.bars) {
      const color = blockColor(b.t);
      const late = isOverdue(b.t);
      const stc = statusColor[b.t.status] || "#94a3b8";
      barPos.set(b.t.id, { x: b.x, y: top + b.y + bh / 2, w: b.w });
      const barCls = "gbar" + (late ? " late" : "") + (b.clipped ? " clipped" : "");
      html += `<div class="${barCls}" data-id="${b.t.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${bh}px;--c:${color};--stc:${stc}"
          title="#${b.t.id} ${esc(b.t.title)}\n${b.t.category.name} • ${fmtNum(b.t.estimatedMinutes)}min${late ? " • ATRASADO" : ""}\n${fmtTime(b.t.startDate)} → ${fmtTime(b.t.dueDate)}${b.clipped ? "\n(barra cortada pelo período visível)" : ""}">
          <span class="gbar-label">#${b.t.id} ${esc(b.t.title)}</span>
        </div>`;
    }
    html += "</div>";
    top += lane.laneH;
  }

  // dependencies overlay
  const arrows: string[] = [];
  for (const lane of lanes) {
    for (const b of lane.bars) {
      const dep = b.t.dependsOn ? b.t.dependsOn.id : b.t.dependsOnTicketId;
      if (dep == null) continue;
      const f = barPos.get(b.t.id);
      const tgt = barPos.get(dep);
      if (!f || !tgt) continue;
      const x1 = f.x;
      const y1 = f.y;
      const x2 = tgt.x + tgt.w;
      const y2 = tgt.y;
      const path = `M ${x1} ${y1} H ${x2 - 16} Q ${x2 - 6} ${y1} ${x2 - 6} ${y2}`;
      const arrow = `M ${x2 - 4} ${y2} l -2 -3 M ${x2 - 4} ${y2} l -2 3`;
      arrows.push(`<path d="${path}" class="g-arrow" fill="none"/>`);
      arrows.push(`<path d="${arrow}" class="g-arrow" stroke-width="1.6" fill="none"/>`);
    }
  }
  html += `<svg class="g-svg" width="${totalPx}" height="${top}" style="height:${top}px">${arrows.join("")}</svg>`;

  if (nowX >= 0 && nowX <= totalPx) {
    html += `<div class="g-now" style="left:${nowX}px"><span>hoje</span></div>`;
  }

  html += "</div></div>";
  el.innerHTML = html;

  el.querySelectorAll<HTMLElement>(".g-scale-btn").forEach((b) =>
    b.addEventListener("click", () => {
      store.ganttScale = b.dataset.scale as GanttScale;
      emit();
    })
  );
  el.querySelectorAll<HTMLElement>(".gbar").forEach((b) =>
    b.addEventListener("click", () => {
      openTicketModal(Number(b.dataset.id), null);
    })
  );
}