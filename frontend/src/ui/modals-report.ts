import { basePriColor, statusLabel, store, weekdays, DAY_MS, analystColors } from "../core/state";
import { capFor, prodCapOfDow } from "../core/analysts";
import { usedMinInDayCached } from "../core/tickets";
import { esc, fmtNum, fmtTime, mondayOf } from "../core/format";
import { openModal } from "./chrome";

function usedPerDay(a: (typeof store.analysts)[number], days: Date[]): number[] {
  return days.map((d) => usedMinInDayCached(a, d));
}

function renderReport(): void {
  const body = document.getElementById("reportBody")!;
  const days: Date[] = (() => {
    const ws = mondayOf(new Date());
    const d: Date[] = [];
    for (let i = 0; i < 7; i++) d.push(new Date(ws.getTime() + i * DAY_MS));
    return d;
  })();
  let html = "";
  html += '<div class="rep-section"><h3>Uso da semana por dia</h3><div class="day-chart">';
  for (let d = 0; d < 7; d++) {
    const date = days[d];
    let capSum = 0;
    let usedSum = 0;
    const segsPerAna = store.analysts.map((a) => {
      const cap = capFor(a, date);
      if (cap <= 0) return null;
      const used = usedMinInDayCached(a, date);
      capSum += cap;
      usedSum += used;
      return { id: a.id, used, cap };
    });
    const stack = segsPerAna
      .filter((s): s is NonNullable<typeof s> => !!s && s.used > 0)
      .map((s, i) => {
        if (s.used <= 0) return "";
        const pct = Math.min((s.used / (capSum || 1)) * 100, 100);
        const color = analystColors[i % analystColors.length];
        const n = store.analysts.find((a) => a.id === s.id)?.name || "";
        return `<div class="seg" style="height:${pct}%;background:${color}" title="${n}: ${fmtNum(s.used)}"></div>`;
      })
      .join("");
    const pctLabel = capSum > 0 ? Math.round((usedSum / capSum) * 100) + "%" : "—";
    html += `<div class="day-col"><div class="dw">${weekdays[(date.getDay() + 6) % 7]}</div><div class="stack">${stack}</div><div class="pct">${pctLabel}</div></div>`;
  }
  html += "</div></div>";

  const remains = store.analysts.map((a) => {
    const remain = a.tickets
      .filter((t) => t.status !== "COMPLETED")
      .reduce((s, t) => s + Math.max(t.estimatedMinutes - (t.workedMinutes || 0), 0), 0);
    const activeCount = a.tickets.filter((t) => t.status !== "COMPLETED").length;
    return { name: a.name, remain, activeCount };
  });
  const maxRemain = Math.max(1, ...remains.map((r) => r.remain));
  html += '<div class="rep-section"><h3>Carga restante por analista</h3>';
  for (const r of remains) {
    html += `<div class="chart-row"><span class="chart-label">${esc(r.name)}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.round((r.remain / maxRemain) * 100)}%"></div></div><span class="chart-val">${fmtNum(r.remain)} • ${r.activeCount} ativos</span></div>`;
  }
  html += "</div>";

  const priCount = [1, 2, 3, 4, 5].map((p) =>
    store.analysts.flatMap((a) => a.tickets.filter((t) => t.status !== "COMPLETED" && t.priority === p))
  );
  const maxPri = Math.max(1, ...priCount.map((l) => l.length));
  html += '<div class="rep-section"><h3>Chamados ativos por prioridade</h3>';
  [1, 2, 3, 4, 5].forEach((p) => {
    const n = priCount[p - 1].length;
    html += `<div class="chart-row"><span class="chart-label">Prioridade P${p}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.round((n / maxPri) * 100)}%;background:${basePriColor[p]}"></div></div><span class="chart-val">${n} chamados</span></div>`;
  });
  html += "</div>";

  html += '<div class="rep-section"><h3>Capacidade — semana vigente</h3>';
  html += '<table class="rep"><thead><tr><th>Analista</th><th>Capacidade</th><th>Ocupado</th><th>Uso</th></tr></thead><tbody>';
  for (const a of store.analysts) {
    const capWeek = days.reduce((s, dd) => s + capFor(a, dd), 0);
    const per = usedPerDay(a, days);
    const availMin = days.reduce((s, dd) => s + prodCapOfDow(a, dd.getDay()), 0);
    if (availMin <= 0) {
      html += `<tr><td>${esc(a.name)}</td><td>${fmtNum(capWeek)}</td><td>—</td><td>—</td></tr>`;
      continue;
    }
    const usedMin = per.reduce((s, x) => s + x, 0);
    const pct = Math.max(0, Math.min(100, Math.round((usedMin / availMin) * 100)));
    html += `<tr><td>${esc(a.name)}</td><td>${fmtNum(capWeek)}</td><td>${fmtNum(usedMin)}</td><td>${pct}%</td></tr>`;
  }
  html += "</tbody></table></div>";

  const byCat = new Map<number, { name: string; count: number; remain: number }>();
  let totalRemain = 0;
  for (const a of store.analysts) {
    for (const t of a.tickets) {
      if (t.status === "COMPLETED") continue;
      const remain = Math.max(t.estimatedMinutes - (t.workedMinutes || 0), 0);
      totalRemain += remain;
      const key = t.category.id;
      if (!byCat.has(key)) byCat.set(key, { name: t.category.name, count: 0, remain: 0 });
      const c = byCat.get(key)!;
      c.count++;
      c.remain += remain;
    }
  }
  const catRows = [...byCat.values()].sort((x, y) => y.remain - x.remain);
  html += '<div class="rep-section"><h3>Carga por categoria (chamados ativos)</h3>';
  html += '<table class="rep"><thead><tr><th>Categoria</th><th>Chamados</th><th>Tempo restante</th></tr></thead><tbody>';
  for (const r of catRows) html += `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${fmtNum(r.remain)}</td></tr>`;
  html += `<tfoot><tr><td>Total</td><td>${catRows.reduce((s, r) => s + r.count, 0)}</td><td>${fmtNum(totalRemain)}</td></tr></tfoot></tbody></table></div>`;

  for (const a of store.analysts) {
    const late = a.tickets.filter((t) => t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate).getTime() < Date.now());
    if (!late.length) continue;
    html += `<div class="rep-section"><h3>Atrasados — ${esc(a.name)}</h3>`;
    html += '<table class="rep"><thead><tr><th>Chamado</th><th>Previsto</th><th>Status</th></tr></thead><tbody>';
    for (const t of late) html += `<tr><td>#${t.id} ${esc(t.title)}</td><td>→ ${fmtTime(t.dueDate)}</td><td>${statusLabel[t.status] || t.status}</td></tr>`;
    html += "</tbody></table></div>";
  }
  body.innerHTML = html || '<div class="empty">Sem dados</div>';
}

export function wireReportModal(): void {
  document.getElementById("reportBtn")?.addEventListener("click", () => {
    renderReport();
    openModal("reportModal");
  });
}