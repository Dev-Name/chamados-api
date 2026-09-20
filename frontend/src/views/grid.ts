import { store, currentZ, statusLabel, DAY_MS, weekdays, WEEK_DOW } from "../core/state";
import type { Analyst, Ticket } from "../core/state";
import { capFor, prodCapOfDow, startForDow, lunchForDow, avatarHtml, weekLabel } from "../core/analysts";
import { blockColor, priorityColor, segmentsOf, usedMinInDay, pctDone, remainOf, isOverdue, stColor } from "../core/tickets";
import { visibleAnalysts, visibleTicket } from "../core/filters";
import { cap, esc, fmtDay, fmtNum, fmtTime, min2time, sameDay, startOf, fmtHour } from "../core/format";
import { periodDays } from "../core/nav";
import { api } from "../core/api";
import { openTicketModal } from "../ui/modals-ticket";
import { openQueueModal } from "../ui/modals-queue";
import { editAnalystFromMenu } from "../ui/modals-analyst";
import { showToast, toggleBandMenu } from "../ui/chrome";
import { emit } from "../core/state";

const SHIFT_START = 9;

function weekFilteredDays(): Date[] {
  const days = periodDays();
  if (store.prefs.hideWeekends && store.view === "week") {
    return days.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  }
  return days;
}

function hourMarkup(capMinutes: number, startMin: number): string {
  const z = currentZ();
  const firstHour = Math.ceil(startMin / 60) * 60;
  let lines = "";
  for (let m = firstHour; m < startMin + capMinutes; m += 60) {
    const y = (m - startMin) * z;
    const hour = Math.round(m / 60);
    const isMajor = hour % 3 === 0;
    lines += `<div class="hour-line${isMajor ? " major" : ""}" style="top:${y}px"></div>`;
    if (isMajor) lines += `<span class="hour-label" style="top:${y}px">${fmtHour(hour)}</span>`;
  }
  return lines;
}

function dayCellHtml(a: Analyst, d: Date, dayH: number, now: Date, isDay: boolean): string {
  void isDay;
  const cap = capFor(a, d);
  if (cap <= 0) {
    return `<div class="day idle" style="height:${dayH}px" data-a="${a.id}" title="Dia sem expediente para ${esc(a.name)}"><span class="idle-label">${esc(weekdays[(d.getDay() + 6) % 7])} — fora do expediente</span></div>`;
  }
  let lines = "";
  const startMin = startForDow(a, d.getDay());
  lines += hourMarkup(cap, startMin);
  const lunch = lunchForDow(a, d.getDay());
  if (lunch) {
    const lt = (lunch.start - startMin) * currentZ();
    const lh = (lunch.end - lunch.start) * currentZ();
    if (lt + lh > 0 && lt < cap * currentZ()) {
      lines += `<div class="lunch" style="top:${Math.max(lt, 0)}px;height:${Math.min(lh, cap * currentZ() - Math.max(lt, 0))}px" title="Almoço ${min2time(lunch.start)} – ${min2time(lunch.end)}"></div>`;
    }
  }
  const otH = dayH - cap * currentZ();
  if (otH > 0) lines += `<div class="ot" style="top:${cap * currentZ()}px;height:${otH}px"></div>`;
  const isToday = sameDay(d, now);
  const cls = "day" + (isToday ? " todayCell" : "");
  return `<div class="${cls}" style="height:${dayH}px" data-a="${a.id}" data-iso="${d.toISOString()}"
              title="Clique para criar um chamado neste dia">
              ${lines}
            </div>`;
}

function placeBlock(band: HTMLElement, segDate: Date, top: number, height: number, t: Ticket): void {
  const cell = band.querySelector<HTMLElement>('.day[data-iso="' + new Date(segDate).toISOString() + '"]');
  if (!cell) return;
  const color = blockColor(t);
  const prc = priorityColor(t.priority);
  const stc = stColor(t);
  const worked = t.workedMinutes || 0;
  const remain = remainOf(t);
  const pct = pctDone(t);
  const late = isOverdue(t);
  const catName =
    store.prefs.colorBy === "priority" ? "P" + t.priority : store.prefs.colorBy === "status" ? statusLabel[t.status] || t.status : t.category.name;
  const dep = t.dependsOn ? `\n⛓ depende do chamado #${t.dependsOn.id}` : "";
  const tooltip =
    `#${t.id} ${t.title}\n${catName} • ${statusLabel[t.status] || t.status}${late ? " • ATRASADO" : ""}\n` +
    `${fmtNum(t.estimatedMinutes)} total${worked > 0 ? ` • ${fmtNum(worked)} trabalhado (${pct}%)` : ""}\n` +
    `${fmtTime(t.startDate)} → ${fmtTime(t.dueDate)}${dep}`;
  const blk = document.createElement("div");
  blk.className = "blk" + (height < 24 ? " tiny" : "") + (late ? " late" : "");
  blk.dataset.id = String(t.id);
  blk.style.top = top + "px";
  blk.style.height = height + "px";
  blk.style.left = "0";
  blk.style.width = "100%";
  blk.style.setProperty("--c", color);
  blk.style.setProperty("--prc", prc);
  blk.style.setProperty("--stc", stc);
  blk.title = tooltip;
  blk.innerHTML =
    `<div class="bt-top"><span class="bt-title">#${t.id} ${esc(t.title)}</span><span class="bt-pill">P${t.priority}</span>` +
    `<span class="st-badge">${statusLabel[t.status] || t.status}</span>` +
    `${late ? '<span class="bt-alert" title="Atrasado"></span>' : ""}</div>` +
    `<div class="bt-meta">${worked > 0 ? "faltam " + fmtNum(remain) : fmtNum(t.estimatedMinutes)} • ${fmtTime(t.startDate)}–${fmtTime(t.dueDate)}</div>` +
    (worked > 0 ? `<div class="bt-progress"><div class="bt-bar" style="width:${pct}%"></div></div>` : "");
  cell.appendChild(blk);
}

export function renderGrid(): void {
  const view = store.view;
  if (view === "month") {
    renderMonth();
    return;
  }
  if (view === "year") {
    renderYear();
    return;
  }
  renderDayWeek(view === "day");
}

function renderDayWeek(isDay: boolean): void {
  const calBody = document.getElementById("calBody")!;
  const calWrap = document.getElementById("calWrap")!;
  calWrap.classList.toggle("noweek", !!store.prefs.hideWeekends && !isDay);
  const ais = visibleAnalysts();
  if (!ais.length) {
    calBody.innerHTML = '<div class="empty">Nenhum analista. Adicione em “Analistas”.</div>';
    return;
  }
  const maxCap = Math.max(
    1,
    ...store.analysts.map((a) => Math.max(...WEEK_DOW.map((dow) => capFor(a, new Date(2026, 0, 4 + dow)))))
  );
  const z = currentZ();
  const dayH = Math.max((maxCap / 60) * 60 * z, 180);
  const days = isDay ? [startOf(store.refDate)] : weekFilteredDays();
  const nCols = days.length;
  const rail = "var(--rail)";
  const template = isDay ? `${rail} repeat(${Math.max(ais.length, 1)}, minmax(150px, 1fr))` : `${rail} repeat(${nCols}, minmax(118px, 1fr))`;
  const now = new Date();

  let head = `<div class="grid-row grid-head${isDay ? " grid-head-day" : ""}" style="grid-template-columns:${template}">
      <div class="lbl" style="top:0;left:0">Horas</div>`;
  if (isDay) {
    const d = days[0];
    for (const a of ais) {
      const isOff = capFor(a, d) <= 0;
      head += `<div class="dhead" style="top:0">
          <span class="dd">${cap(weekdays[(d.getDay() + 6) % 7])}, ${fmtDay(d)}</span>
          <span class="ds" title="${esc(a.name)}">${esc(a.name)}${isOff ? " • sem expediente" : ""}</span>
        </div>`;
    }
  } else {
    for (const d of days) {
      const isToday = sameDay(d, now);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      let usedSum = 0;
      let capSum = 0;
      for (const a of ais) {
        const c = capFor(a, d);
        if (c > 0) {
          capSum += prodCapOfDow(a, d.getDay());
          usedSum += usedMinInDay(a, d);
        }
      }
      const pct = capSum > 0 ? Math.round((usedSum / capSum) * 100) + "%" : "";
      head += `<div class="dhead ${isToday ? "today" : ""} ${isWeekend ? "weekend" : ""}" style="top:0">
          <span class="dd">${isToday ? '<span class="pill">hoje</span>' : ""}${weekdays[(d.getDay() + 6) % 7]} ${d.getDate()}</span>
          <span class="dload">${pct || "folga"}</span>
        </div>`;
    }
  }
  head += "</div>";

  let rows = "";
  for (const a of ais) {
    const workDays = days.filter((d) => capFor(a, d) > 0);
    const freeAvail = workDays.reduce((s, d) => s + prodCapOfDow(a, d.getDay()), 0);
    const usageAll = workDays.length
      ? { used: workDays.reduce((s, d) => s + usedMinInDay(a, d), 0), avail: freeAvail }
      : null;
    const pct = usageAll ? Math.round((usageAll.used / usageAll.avail) * 100) : 0;
    const wkColor = !usageAll ? "" : usageAll.used / usageAll.avail < 0.6 ? "#059669" : usageAll.used / usageAll.avail < 0.85 ? "#d97706" : "#dc2626";
    const activeCount = a.tickets.filter((t) => t.status !== "COMPLETED").length;
    const dayTotal = workDays.reduce((s, d) => s + usedMinInDay(a, d), 0);

    rows += `<div class="grid-row band${isDay ? " dayband" : ""}" id="band-${a.id}" data-a="${a.id}" style="grid-template-columns:${template}">
        <div class="band-label">
          <span class="bname" title="${esc(weekLabel(a))}">${avatarHtml(a)}<span class="nm" title="${esc(a.name)}">${esc(a.name)}</span>
            <span class="bmenu-wrap">
              <button class="bmenu" data-menu="${a.id}" title="Ações rápidas">⋮</button>
              <div class="band-menu" id="bmenu-${a.id}">
                <button data-queue="${a.id}" title="Veja e defina a ordem de prioridade dos chamados"><span class="bmenu-ico"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4.5h11"/><path d="M2.5 8h7.5"/><path d="M2.5 11.5h4.5"/></svg></span>Reorganizar Ordem</button>
                <button data-recalc="${a.id}" title="Reprograma as datas previstas"><span class="bmenu-ico"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M8 5.2v3l2 1.4"/></svg></span>Reprogramar Chamados</button>
                <button data-edit-analyst="${a.id}" title="Abre o cadastro do analista"><span class="bmenu-ico"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.8l2.7 2.7L5.3 13.4 2 14l.6-3.3 7.9-7.9z"/></svg></span>Editar Analista</button>
              </div>
            </span>
          </span>
          ${usageAll ? `<span class="bcap wk" style="color:${wkColor}" title="Ocupado: ${fmtNum(dayTotal)} · disponível: ${fmtNum(usageAll.avail)}">${activeCount} chamado(s) · ${pct}%</span>` : ""}
        </div>`;

    if (isDay) {
      rows += dayCellHtml(a, days[0], dayH, now, isDay);
    } else {
      for (const d of days) rows += dayCellHtml(a, d, dayH, now, isDay);
    }
    rows += "</div>";
  }

  calBody.innerHTML = head + rows;

  for (const a of ais) {
    const band = document.getElementById("band-" + a.id) as HTMLElement | null;
    if (!band) continue;
    for (const t of a.tickets) {
      if (t.status === "COMPLETED" || !visibleTicket(t)) continue;
      for (const seg of segmentsOf(t, a)) {
        if (capFor(a, seg.date) <= 0) continue;
        const inRange = days.some((d) => sameDay(d, seg.date));
        if (!inRange) continue;
        const startMin = startForDow(a, seg.date.getDay());
        let top = (seg.from - startMin) * z;
        let bottom = (seg.to - startMin) * z;
        if (bottom <= 0) continue;
        const cap = capFor(a, seg.date);
        if (bottom > cap * z) bottom = cap * z;
        if (top < 0) top = 0;
        placeBlock(band, seg.date, top, Math.max(bottom - top, 4), t);
      }
    }
  }
  installNowLines();
}

export function installNowLines(): void {
  const calBody = document.getElementById("calBody");
  if (!calBody) return;
  const now = new Date();
  const mn = now.getHours() * 60 + now.getMinutes();
  const z = currentZ();
  calBody.querySelectorAll<HTMLElement>(".day.todayCell").forEach((cell) => {
    cell.querySelectorAll(".now-line").forEach((l) => l.remove());
    const a = store.analysts.find((x) => String(x.id) === cell.dataset.a);
    const startMin = a ? startForDow(a, new Date(cell.dataset.iso || "").getDay()) : SHIFT_START * 60;
    const top = (mn - startMin) * z;
    if (top < 0) return;
    const line = document.createElement("div");
    line.className = "now-line";
    line.style.top = Math.min(top, cell.clientHeight - 3) + "px";
    cell.appendChild(line);
  });
}

export function moveNow(): void {
  const calBody = document.getElementById("calBody");
  if (!calBody) return;
  const now = new Date();
  const mn = now.getHours() * 60 + now.getMinutes();
  const z = currentZ();
  calBody.querySelectorAll<HTMLElement>(".now-line").forEach((el) => {
    const cell = el.closest<HTMLElement>(".day");
    const a = cell ? store.analysts.find((x) => String(x.id) === cell.dataset.a) : null;
    const startMin = a && cell ? startForDow(a, new Date(cell.dataset.iso || "").getDay()) : SHIFT_START * 60;
    const top = (mn - startMin) * z;
    const inShift = top >= 0 && !!cell;
    el.style.display = inShift ? "" : "none";
    if (inShift && cell) el.style.top = Math.min(top, cell.clientHeight - 3) + "px";
  });
}

// ---------- drag & drop ----------
interface DragState {
  active: boolean;
  id: number | null;
  bandId: number | null;
  ghost: HTMLElement | null;
  src: HTMLElement | null;
  moved: boolean;
  lastCell: HTMLElement | null;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
}

const drag: DragState = {
  active: false,
  id: null,
  bandId: null,
  ghost: null,
  src: null,
  moved: false,
  lastCell: null,
  sx: 0,
  sy: 0,
  dx: 0,
  dy: 0,
};

let lastDragAt = 0;

function desiredOrder(a: Analyst, me: Ticket, targetMs: number): number[] {
  const others = a.tickets.filter((t) => t.status !== "COMPLETED" && t.id !== me.id);
  let anchorIdx = -1;
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    const s = o.startDate ? new Date(o.startDate).getTime() : Infinity;
    if (s <= targetMs) anchorIdx = i;
    else break;
  }
  const ids = others.map((t) => t.id);
  ids.splice(anchorIdx + 1, 0, me.id);
  return ids;
}

function dragStart(e: PointerEvent, blk: HTMLElement): void {
  const rect = blk.getBoundingClientRect();
  const ghost = blk.cloneNode(true) as HTMLElement;
  ghost.classList.remove("src");
  ghost.classList.add("ghost");
  ghost.style.width = Math.max(rect.width, 190) + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);
  blk.classList.add("src");
  drag.active = true;
  drag.id = Number(blk.dataset.id);
  drag.bandId = Number(blk.closest(".band")?.getAttribute("data-a"));
  drag.ghost = ghost;
  drag.src = blk;
  drag.moved = false;
  drag.sx = e.clientX;
  drag.sy = e.clientY;
  drag.dx = e.clientX - rect.left;
  drag.dy = e.clientY - rect.top;
  drag.lastCell = null;
}

function dragMove(e: PointerEvent): void {
  if (!drag.active) return;
  if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
  const gx = e.clientX - drag.dx;
  const gy = e.clientY - drag.dy;
  if (drag.ghost) {
    drag.ghost.style.left = gx + "px";
    drag.ghost.style.top = gy + "px";
  }
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const cell = under ? (under.closest(".day") as HTMLElement | null) : null;
  const band = drag.src ? drag.src.closest(".band") : null;
  if (drag.lastCell && drag.lastCell !== cell) drag.lastCell.classList.remove("drop");
  if (cell && band && cell.closest(".band") === band) {
    cell.classList.add("drop");
    drag.lastCell = cell;
  } else {
    drag.lastCell = null;
  }
}

export function cancelDrag(): boolean {
  if (!drag.active) return false;
  dragEndSafe();
  return true;
}

function dragEndSafe(): void {
  if (drag.ghost) drag.ghost.remove();
  if (drag.src) drag.src.classList.remove("src");
  if (drag.lastCell) drag.lastCell.classList.remove("drop");
  drag.active = false;
  drag.ghost = null;
  drag.src = null;
  drag.lastCell = null;
  drag.bandId = null;
  drag.id = null;
}

function dragEnd(e: PointerEvent): void {
  if (!drag.active) return;
  const shallMove = drag.moved;
  const cell = drag.lastCell;
  const analystId = drag.bandId;
  const ticketId = drag.id;
  const band = drag.src ? drag.src.closest(".band") : null;
  dragEndSafe();
  if (!shallMove || !cell || !band || analystId == null || ticketId == null) return;
  const a = store.analysts.find((x) => x.id === analystId);
  const t = a ? a.tickets.find((x) => x.id === ticketId) : null;
  if (!a || !t) return;
  const r = cell.getBoundingClientRect();
  const z = currentZ();
  const relMin = Math.max(0, (e.clientY - r.top) / z);
  const target = new Date(cell.dataset.iso || "");
  const minOfDayAt = startForDow(a, target.getDay()) + Math.round(relMin / 15) * 15;
  target.setMinutes(minOfDayAt, 0, 0);
  const order = desiredOrder(a, t, target.getTime());
  lastDragAt = Date.now();
  api(`/analysts/${analystId}/reorder`, "POST", { order })
    .then(() => {
      showToast("Chamado #" + t.id + " reagendado");
      emit();
    })
    .catch((err: Error) => {
      showToast("Erro: " + err.message);
      emit();
    });
}

// ---------- delegacão de cliques ----------
function handleCalBodyClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const menuBtn = t.closest<HTMLElement>("[data-menu]");
  if (menuBtn) {
    e.stopPropagation();
    toggleBandMenu(menuBtn.dataset.menu || "", menuBtn);
    return;
  }
  const recalcBtn = t.closest<HTMLElement>("[data-recalc]");
  if (recalcBtn) {
    e.stopPropagation();
    recalcOne(Number(recalcBtn.dataset.recalc));
    return;
  }
  const queueBtn = t.closest<HTMLElement>("[data-queue]");
  if (queueBtn) {
    e.stopPropagation();
    openQueueModal(Number(queueBtn.dataset.queue));
    return;
  }
  const editBtn = t.closest<HTMLElement>("[data-edit-analyst]");
  if (editBtn) {
    e.stopPropagation();
    editAnalystFromMenu(Number(editBtn.dataset.editAnalyst));
    return;
  }
  if (Date.now() - lastDragAt < 350) return;
  const blk = t.closest<HTMLElement>(".blk");
  if (blk) {
    openTicketModal(Number(blk.dataset.id), null);
    return;
  }
  const mday = t.closest<HTMLElement>(".mday");
  if (mday && !mday.classList.contains("out")) {
    store.refDate = startOf(new Date(mday.dataset.iso || ""));
    store.view = "day";
    emit();
    return;
  }
  const tile = t.closest<HTMLElement>(".mtile");
  if (tile) {
    store.refDate = new Date(store.refDate.getFullYear(), Number(tile.dataset.goMonth), 1);
    store.view = "month";
    emit();
    return;
  }
  const cell = t.closest<HTMLElement>(".day");
  if (cell && !cell.classList.contains("idle")) {
    openTicketModal(null, Number(cell.dataset.a) || null);
  }
}

async function recalcOne(id: number): Promise<void> {
  try {
    await api(`/analysts/${id}/recalculate`, "POST");
    showToast("Fila recalculada");
    emit();
  } catch (err) {
    showToast("Erro: " + (err as Error).message);
    emit();
  }
}

// ---------- visão mensal ----------
function monthMatrix(y: number, m: number): Array<{ d: Date; out: boolean }> {
  const st = new Date(y, m, 1);
  const lead = (st.getDay() + 6) % 7;
  const start = new Date(st.getTime() - lead * DAY_MS);
  const daysIn = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysIn) / 7);
  const cells: Array<{ d: Date; out: boolean }> = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    cells.push({ d, out: d.getMonth() !== m });
  }
  return cells;
}

function renderMonth(): void {
  const calBody = document.getElementById("calBody")!;
  const y = store.refDate.getFullYear();
  const m = store.refDate.getMonth();
  const now = new Date();
  let html = '<div class="month">';
  for (let i = 0; i < 7; i++) html += `<div class="m-head">${weekdays[i]}</div>`;
  for (const c of monthMatrix(y, m)) {
    const d = c.d;
    const isToday = sameDay(d, now);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const ais = visibleAnalysts();
    const chips: Array<{ c: string; t: string; id: number; title: string }> = [];
    let usedSum = 0;
    let capSum = 0;
    for (const a of ais) {
      const cap = capFor(a, d);
      if (cap <= 0) continue;
      capSum += prodCapOfDow(a, d.getDay());
      usedSum += usedMinInDay(a, d);
      for (const t of a.tickets) {
        if (t.status === "COMPLETED" || !visibleTicket(t)) continue;
        let added = false;
        for (const seg of segmentsOf(t, a)) {
          if (sameDay(seg.date, d)) {
            if (!added) chips.push({ c: blockColor(t), t: fmtTime(new Date(seg.date.getTime() + seg.from * 60000)), id: t.id, title: t.title });
            added = true;
          }
        }
      }
    }
    const shown = chips.slice(0, 3);
    const more = chips.length - shown.length;
    const loadPct = capSum > 0 ? Math.min((usedSum / capSum) * 100, 100) : 0;
    html += `<div class="mday ${c.out ? "out" : ""} ${isToday ? "today" : ""} ${isWeekend ? "weekend" : ""} ${chips.length ? "" : "empty"}"
                data-iso="${d.toISOString()}" data-a="" ${c.out ? "" : 'title="Clique para ver este dia"'}>
        <span class="mnum">${d.getDate()}</span>
        <div class="mbody">`;
    if (c.out) html += '<div class="mc-more"></div>';
    else {
      for (const ch of shown) html += `<div class="mc" style="--c:${ch.c}"><span class="t">${ch.t}</span><span class="tt">#${ch.id} ${esc(ch.title)}</span></div>`;
      if (more > 0) html += `<div class="mc more">+${more}</div>`;
      html += '<div class="mc-hint">+</div>';
    }
    html += `</div>
        ${c.out ? "" : capSum > 0 ? `<div class="mload"><div class="tr"><i style="width:${loadPct}%"></i></div><b>${fmtNum(Math.min(usedSum, capSum))}</b></div>` : ""}
      </div>`;
  }
  html += "</div>";
  calBody.innerHTML = html;
}

// ---------- visão anual ----------
function renderYear(): void {
  const calBody = document.getElementById("calBody")!;
  const y = store.refDate.getFullYear();
  const now = new Date();
  const days = periodDays();
  const byDate = new Map<string, number>();
  let maxDay = 1;
  let totalUsed = 0;
  let distinct = 0;
  for (const d of days) {
    let used = 0;
    for (const a of visibleAnalysts()) used += usedMinInDay(a, d);
    byDate.set(d.toISOString().slice(0, 10), used);
    totalUsed += used;
    if (used > maxDay) maxDay = used;
  }
  for (const a of visibleAnalysts()) {
    for (const t of a.tickets) {
      if (t.status !== "COMPLETED") distinct++;
    }
  }

  let html = '<div class="year">';
  for (let mm = 0; mm < 12; mm++) {
    let monthUsed = 0;
    const cells = monthMatrix(y, mm);
    let heat = "";
    for (const c of cells) {
      const k = c.d.toISOString().slice(0, 10);
      const used = byDate.get(k) || 0;
      const q = Math.min(used / maxDay, 1);
      const isToday = sameDay(c.d, now);
      const style = c.out ? "background:var(--out-bg)" : used > 0 ? `background:color-mix(in srgb, var(--primary) ${Math.round(q * 100)}%, var(--track))` : "";
      const title = `${c.d.toLocaleDateString("pt-BR")}${used > 0 ? " — " + fmtNum(used) : ""}`;
      heat += `<div class="hc ${c.out ? "out" : ""}" style="${style} ${isToday ? "outline:2px solid var(--primary);outline-offset:-1px" : ""}" title="${title}"></div>`;
      monthUsed += used;
    }
    const mn = new Date(y, mm, 1);
    const monthLabel = cap(mn.toLocaleDateString("pt-BR", { month: "long" }));
    html += `<div class="mtile" data-go-month="${mm}" title="Clique para ver ${monthLabel} em detalhes">
        <h3>${monthLabel}</h3>
        <div class="stat">${fmtNum(monthUsed)} previstas</div>
        <div class="heat">${heat}</div>
      </div>`;
  }
  html += "</div>";

  html += `<div class="year-summary">
      <div><b>${fmtNum(totalUsed)}</b><span>de trabalho previsto no ano</span></div>
      <div><b>${distinct}</b><span>chamados ativos</span></div>
    </div>`;
  calBody.innerHTML = html;
}

export function wireGridView(): void {
  const calBody = document.getElementById("calBody")!;
  calBody.addEventListener("pointerdown", (e) => {
    const blk = (e.target as HTMLElement).closest<HTMLElement>(".blk");
    if (!blk || (e.button !== undefined && e.button !== 0)) return;
    if (store.view !== "day" && store.view !== "week") return;
    e.preventDefault();
    dragStart(e, blk);
  });
  window.addEventListener("pointermove", dragMove);
  window.addEventListener("pointerup", dragEnd);
  window.addEventListener("pointercancel", dragEnd);
  calBody.addEventListener("click", handleCalBodyClick);
}