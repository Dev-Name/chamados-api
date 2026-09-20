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
  const ybtn = t.closest<HTMLElement>("[data-goto-month]");
  if (ybtn) {
    store.refDate = new Date(store.refDate.getFullYear(), Number(ybtn.dataset.gotoMonth), 1);
    store.view = "month";
    emit();
    return;
  }
  const yday = t.closest<HTMLElement>(".yday");
  if (yday && yday.dataset.iso) {
    store.refDate = startOf(new Date(yday.dataset.iso));
    store.view = "day";
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
interface MonthStat {
  used: number;
  cap: number;
  active: number;
  late: number;
  done: number;
  dayUsed: number[];
  dayCap: number[];
}

function monthStat(y: number, m: number): MonthStat {
  const ais = visibleAnalysts();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const st = { used: 0, cap: 0, active: 0, late: 0, done: 0, dayUsed: [], dayCap: [] } as MonthStat;
  const first = new Date(y, m, 1).getTime();
  const last = new Date(y, m + 1, 0).getTime();
  for (let dd = 1; dd <= daysIn; dd++) {
    const d = new Date(y, m, dd);
    let du = 0;
    let dc = 0;
    for (const a of ais) {
      dc += prodCapOfDow(a, d.getDay());
      du += usedMinInDay(a, d);
    }
    st.dayUsed.push(du);
    st.dayCap.push(dc);
    st.used += du;
    st.cap += dc;
  }
  for (const a of ais) {
    for (const t of a.tickets) {
      if (!visibleTicket(t)) continue;
      const s = t.startDate ? new Date(t.startDate).getTime() : null;
      const e = t.dueDate ? new Date(t.dueDate).getTime() : null;
      if (s == null || e == null || s > last || e < first) continue;
      if (t.status === "COMPLETED") st.done++;
      else {
        st.active++;
        if (isOverdue(t)) st.late++;
      }
    }
  }
  return st;
}

function dayLoadCls(used: number, cap: number): string {
  if (cap <= 0) return used > 0 ? "yd-3" : "";
  if (used === 0) return "yd-0";
  const r = used / cap;
  if (r < 0.8) return "yd-1";
  if (r <= 1) return "yd-2";
  return "yd-3";
}

function monthBadge(occ: number, cap: number): { cls: string; txt: string } {
  if (cap <= 0) return { cls: "yb-none", txt: "Sem expediente" };
  if (occ >= 1) return { cls: "yb-over", txt: "Sobrecarga" };
  if (occ >= 0.8) return { cls: "yb-warn", txt: "Atenção" };
  return { cls: "yb-ok", txt: "Saudável" };
}

function renderYear(): void {
  const calBody = document.getElementById("calBody")!;
  const y = store.refDate.getFullYear();
  const now = new Date();
  const ais = visibleAnalysts();

  let html = `<div class="year-head">
      <h2>Análise de ${y}</h2>
      <div class="year-legend">
        <span class="yl-item"><i class="yl-s yl-o"></i>Fora do expediente</span>
        <span class="yl-item"><i class="yl-s yl-0"></i>Sem chamados</span>
        <span class="yl-item"><i class="yl-s yl-1"></i>Saudável (&lt;80%)</span>
        <span class="yl-item"><i class="yl-s yl-2"></i>Próximo do limite</span>
        <span class="yl-item"><i class="yl-s yl-3"></i>Sobrecarga (&gt;100%)</span>
      </div>
      <span class="year-clue">Clique num dia para abrir · passe o mouse para ver os detalhes</span>
    </div><div class="year">`;

  for (let mm = 0; mm < 12; mm++) {
    const st = monthStat(y, mm);
    const occ = st.cap > 0 ? st.used / st.cap : st.used > 0 ? 9 : 0;
    const badge = monthBadge(occ, st.cap);
    const occPct = Math.round(occ * 100);
    const barPct = Math.min(occPct, 100);
    const mn = new Date(y, mm, 1);
    const monthLabel = cap(mn.toLocaleDateString("pt-BR", { month: "long" }));

    let heat = "";
    for (const c of monthMatrix(y, mm)) {
      if (c.out) {
        heat += `<div class="yday sp0"></div>`;
        continue;
      }
      const dd = c.d.getDate();
      const du = st.dayUsed[dd - 1];
      const dc = st.dayCap[dd - 1];
      const isToday = sameDay(c.d, now);
      const cls = dayLoadCls(du, dc);
      const tipLines = [
        `${c.d.getDate()} de ${cap(c.d.toLocaleDateString("pt-BR", { month: "long" }))} de ${c.d.getFullYear()}`,
        du > 0 ? `${fmtNum(du)} alocadas${dc > 0 ? " de " + fmtNum(dc) : ""}` : "sem chamados",
      ];
      let listed = 0;
      for (const a of ais) {
        for (const t of a.tickets) {
          if (t.status === "COMPLETED" || !visibleTicket(t)) continue;
          for (const seg of segmentsOf(t, a)) {
            if (sameDay(seg.date, c.d)) {
              if (listed < 4) tipLines.push(`#${t.id} ${t.title}`);
              listed++;
              break;
            }
          }
        }
      }
      if (listed > 4) tipLines.push(`+${listed - 4} outros chamados`);
      const tip = du > 0 || listed > 0 ? ` data-tip="${esc(tipLines.join("\n"))}"` : "";
      const off = dc <= 0 && du === 0 ? ' style="background:var(--out-bg)"' : "";
      heat += `<div class="yday${cls ? " " + cls : ""}${isToday ? " today" : ""}" data-iso="${c.d.toISOString()}"${tip}${off} title="Clique para abrir este dia">${dd}</div>`;
    }

    html += `<div class="ycard">
      <div class="yc-top">
        <h3>${monthLabel}</h3>
        <span class="yc-badge ${badge.cls}">${badge.txt}</span>
      </div>
      <div class="yc-metrics">
        <span class="yc-k">${fmtNum(st.used)}</span>
        <span>/ ${fmtNum(st.cap)}</span>
        <span class="yc-pct">${occPct}%</span>
      </div>
      <div class="yc-bar"><div class="yc-fill" style="width:${barPct}%"></div></div>
      <div class="yc-counts">
        <span class="yc-c"><b>${st.active}</b> ${st.active === 1 ? "chamado ativo" : "chamados ativos"}</span>
        <span class="yc-c ${st.late > 0 ? "bad" : ""}"><b>${st.late}</b> ${st.late === 1 ? "atrasado" : "atrasados"}</span>
        <span class="yc-c ok"><b>${st.done}</b> concluídos</span>
      </div>
      <div class="yheat">${heat}</div>
      <div><button class="ybtn" data-goto-month="${mm}" title="Abrir ${monthLabel} de ${y} na visão de Mês">Ver detalhes do mês</button></div>
    </div>`;
  }
  html += "</div>";
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