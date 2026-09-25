import type { Analyst } from "./state";
import { analystColors, SHIFT_START, WEEK_DOW, DOW_NAMES } from "./state";
import { esc, min2time, workdaysShort } from "./format";

export function capOfDow(a: Analyst, dow: number): number {
  const w = a.weeklyCapacityMinutes;
  if (Array.isArray(w) && w.length === 7) return w[dow] || 0;
  return a.workDays.includes(dow) ? a.dailyCapacityMinutes || 0 : 0;
}

export function capFor(a: Analyst, date: Date): number {
  return capOfDow(a, date.getDay());
}

export function startForDow(a: Analyst, dow: number): number {
  const w = a.weeklyStartMinutes;
  if (Array.isArray(w) && w.length === 7 && w[dow] != null && w[dow] >= 0) return w[dow];
  return SHIFT_START * 60;
}

export function workRange(a: Analyst, dow: number): { start: number; end: number } | null {
  const cap = capOfDow(a, dow);
  if (cap <= 0) return null;
  const start = startForDow(a, dow);
  return { start, end: start + cap };
}

export function lunchForDow(a: Analyst, dow: number): { start: number; end: number } | null {
  const ws = a.weeklyLunchStartMinutes;
  const we = a.weeklyLunchEndMinutes;
  if (Array.isArray(ws) && ws.length === 7 && Array.isArray(we) && we.length === 7) {
    const s = ws[dow];
    const e = we[dow];
    if (s != null && e != null && s >= 0 && e >= 0 && e > s) return { start: s, end: e };
    return null;
  }
  if (a.lunchStartMinutes != null && a.lunchEndMinutes != null && a.lunchEndMinutes > a.lunchStartMinutes) {
    return { start: a.lunchStartMinutes, end: a.lunchEndMinutes };
  }
  return null;
}

export function prodCapOfDow(a: Analyst, dow: number): number {
  const cap = capOfDow(a, dow);
  if (cap <= 0) return 0;
  const start = startForDow(a, dow);
  const lunch = lunchForDow(a, dow);
  if (!lunch) return cap;
  const ls = Math.max(lunch.start, start);
  const le = Math.min(lunch.end, start + cap);
  if (le <= ls) return cap;
  return Math.max(0, cap - (le - ls));
}

export function lunchLabel(a: Analyst): string {
  const items = WEEK_DOW.filter((d) => lunchForDow(a, d));
  if (!items.length) return "Sem almoço";
  const first = lunchForDow(a, items[0])!;
  const allSame = items.every((d) => {
    const l = lunchForDow(a, d)!;
    return l.start === first.start && l.end === first.end;
  });
  if (allSame) return `${min2time(first.start)}–${min2time(first.end)}`;
  return items
    .map((d) => `${DOW_NAMES[d]} ${min2time(lunchForDow(a, d)!.start)}–${min2time(lunchForDow(a, d)!.end)}`)
    .join(" · ");
}

export function scheduleLabel(a: Analyst): string {
  const items = WEEK_DOW.map((d) => {
    const r = workRange(a, d);
    return r ? { d, key: r.start + ":" + r.end, start: r.start, end: r.end } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return "Sem expediente";
  const groups: Array<{ key: string; days: number[]; start: number; end: number }> = [];
  let cur = { key: items[0].key, days: [items[0].d], start: items[0].start, end: items[0].end };
  for (let i = 1; i < items.length; i++) {
    const e = items[i];
    const last = cur.days[cur.days.length - 1];
    if (e.key === cur.key && e.d === ((last + 1) % 7)) cur.days.push(e.d);
    else {
      groups.push(cur);
      cur = { key: e.key, days: [e.d], start: e.start, end: e.end };
    }
  }
  groups.push(cur);
  return groups
    .map((g) => {
      const range = g.days.length === 1 ? DOW_NAMES[g.days[0]] : DOW_NAMES[g.days[0]] + "–" + DOW_NAMES[g.days[g.days.length - 1]];
      return range + " " + min2time(g.start) + "–" + min2time(g.end);
    })
    .join(" | ");
}

export function weekLabel(a: Analyst): string {
  const days = WEEK_DOW.filter((d) => capOfDow(a, d) > 0);
  if (!days.length) return "sem expediente";
  const caps = days.map((d) => capOfDow(a, d));
  const starts = days.map((d) => startForDow(a, d));
  const same = caps.every((c) => c === caps[0]) && starts.every((s) => s === starts[0]);
  if (same) return workdaysShort(days) + " · " + min2time(starts[0]) + "–" + min2time(starts[0] + caps[0]);
  return days
    .map((d) => DOW_NAMES[d] + " " + min2time(startForDow(a, d)) + "–" + min2time(startForDow(a, d) + capOfDow(a, d)))
    .join(" · ");
}

export function analystColor(a: Analyst): string {
  return analystColors[a.id % analystColors.length];
}

export function avatarHtml(a: Analyst, size?: number): string {
  const dim = size
    ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px;border-radius:${Math.round(size * 0.32)}px;`
    : "";
  if (a.photo) {
    return `<span class="avatar pic" title="${esc(a.name)}" style="background-image:url('${a.photo}');background-size:cover;background-position:center;${dim}"></span>`;
  }
  return `<span class="avatar" title="${esc(a.name)}" style="background:${analystColor(a)};${dim}">${esc((a.name || "?")[0])}</span>`;
}

// ---------- Disponibilidade (desligamento + férias) ----------

/** Data local do dispositivo no formato AAAA-MM-DD (referência de "hoje"). */
export function todayLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extrai o date-only (AAAA-MM-DD) de uma data ISO vinda da API. */
export function isoDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
}

/** Analista desligado quando data_desligamento <= hoje. */
export function isTerminated(a: Analyst, ref: Date = new Date()): boolean {
  const d = isoDateOf(a.data_desligamento);
  return d != null && d <= todayLocalISO(ref);
}

/** Analista ausente quando o instante `ref` cai em algum intervalo de ausência. */
export function absentOn(a: Analyst, ref: Date = new Date()): boolean {
  const t = ref.getTime();
  return (a.absences || []).some((x) => {
    const s = new Date(x.data_hora_inicio).getTime();
    const e = new Date(x.data_hora_fim).getTime();
    return s <= t && t <= e;
  });
}

/** Disponível para novas atribuições. */
export function isAvailableOn(a: Analyst, ref: Date = new Date()): boolean {
  return !isTerminated(a, ref) && !absentOn(a, ref);
}

/** Label curto de indisponibilidade, se houver. */
export function unavailabilityLabel(a: Analyst, ref: Date = new Date()): string | null {
  if (isTerminated(a, ref)) return "desligado";
  if (absentOn(a, ref)) return "ausente";
  return null;
}

/** Info de opção para selects de atribuição (modal de chamado, tabela). */
export function analystOptionInfo(
  a: Analyst,
  currentId?: number | null
): { value: string; label: string; disabled: boolean } {
  const un = unavailabilityLabel(a);
  return {
    value: String(a.id),
    label: un ? `${a.name} (${un})` : a.name,
    disabled: !!un && a.id !== currentId,
  };
}