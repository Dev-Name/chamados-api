import { store } from "../core/state";
import { visibleAnalysts } from "../core/filters";
import { capFor, prodCapOfDow, avatarHtml } from "../core/analysts";
import { usedMinInDay } from "../core/tickets";
import { esc, fmtNum, sameDay, mondayOf } from "../core/format";
import { DAY_MS } from "../core/state";
import { openTicketModal } from "../ui/modals-ticket";

export const LOAD_DAYS = 30;

function heatColor(frac: number): string {
  if (frac <= 0.25) return "var(--load-lo)";
  if (frac <= 0.5) return "var(--load-medlo)";
  if (frac <= 0.75) return "var(--load-med)";
  if (frac <= 1) return "var(--load-hi)";
  return "var(--load-over)";
}

export function renderLoad(): void {
  const el = document.getElementById("viewContainer")!;
  const ais = visibleAnalysts();
  if (!ais.length) {
    el.innerHTML = '<div class="empty">Nenhum analista.</div>';
    return;
  }
  const start = mondayOf(store.refDate);
  const now = new Date();
  const days: Date[] = [];
  for (let i = 0; i < LOAD_DAYS; i++) days.push(new Date(start.getTime() + i * DAY_MS));

  let html = '<div class="ld-toolbar"><span class="ld-hint">Ocupação da equipe nos próximos ' + LOAD_DAYS + " dias (clique numa célula para criar chamado)</span></div>";
  html += '<div class="ld-scroll"><table class="ld">';
  html += '<thead><tr><th class="ld-a">Analista</th>';
  for (const d of days) {
    const isToday = sameDay(d, now);
    const isSat = d.getDay() === 6;
    const isSun = d.getDay() === 0;
    html += `<th class="ld-d ${isToday ? "tdy" : ""} ${isSat || isSun ? "we" : ""}" title="${d.toLocaleDateString("pt-BR")}">${d.getDate()}</th>`;
  }
  html += '<th class="ld-sum">Σ</th></tr></thead><tbody>';

  for (const a of ais) {
    let rowUsed = 0;
    let rowCap = 0;
    let cells = "";
    for (const d of days) {
      const cap = capFor(a, d);
      if (cap <= 0) {
        cells += `<td class="ld-off" title="${esc(a.name)} — fora do expediente"></td>`;
        continue;
      }
      const avail = prodCapOfDow(a, d.getDay());
      const used = usedMinInDay(a, d);
      const frac = avail > 0 ? used / avail : 0;
      rowUsed += used;
      rowCap += avail;
      const pct = avail > 0 ? Math.round(frac * 100) : 0;
      cells += `<td class="ld-c" style="background:${heatColor(frac)}" data-a="${a.id}" data-iso="${d.toISOString()}" data-pct="${pct}"
          title="${fmtNum(used)} / ${fmtNum(avail)} min (${pct}%) — ${esc(a.name)}"></td>`;
    }
    const rowFrac = rowCap > 0 ? rowUsed / rowCap : 0;
    html += `<tr>
      <td class="ld-a">${avatarHtml(a, 18)}<span class="ld-name">${esc(a.name)}</span></td>
      ${cells}
      <td class="ld-sum" style="background:${heatColor(rowFrac)}">${rowCap > 0 ? Math.round(rowFrac * 100) + "%" : "—"}</td>
    </tr>`;
  }

  html += "<tr class='ld-tot'><td>Total</td>";
  for (const d of days) {
    let used = 0;
    let cap = 0;
    for (const a of ais) {
      const c = capFor(a, d);
      if (c <= 0) continue;
      used += usedMinInDay(a, d);
      cap += prodCapOfDow(a, d.getDay());
    }
    const frac = cap > 0 ? used / cap : 0;
    html += `<td style="background:${heatColor(frac)}">${cap > 0 ? Math.round(frac * 100) + "%" : ""}</td>`;
  }
  html += "<td></td></tr></tbody></table></div>";

  el.innerHTML = html;

  el.querySelectorAll<HTMLElement>(".ld-c").forEach((c) =>
    c.addEventListener("click", () => {
      openTicketModal(null, Number(c.dataset.a));
    })
  );
}