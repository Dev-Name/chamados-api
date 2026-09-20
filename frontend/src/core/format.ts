export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function startOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return startOf(a).getTime() === startOf(b).getTime();
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDay(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function longDay(d: Date): string {
  return cap(d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
}

export function longMonth(d: Date): string {
  return cap(d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
}

export function fmtTime(d: string | Date | null): string {
  if (!d) return "–";
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtHour(h: number): string {
  return String(h).padStart(2, "0") + ":00";
}

export function minOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtNum(m: number): string {
  const h = m / 60;
  if (h === 0) return "0h";
  const s = Number.isInteger(h) ? String(Math.round(h)) : (Math.round(h * 10) / 10).toFixed(1).replace(".", ",");
  return s + "h";
}

export function min2time(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0");
}

export function timeToMin(s: string): number | null {
  if (!s) return null;
  const [hh, mm] = s.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;
  return hh * 60 + mm;
}

export function esc(s: unknown): string {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

export function workdaysShort(workDays: number[]): string {
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const days = [...workDays].sort((a, b) => (a % 7) - (b % 7));
  const s = new Set(days);
  const run = (arr: number[]) => arr.every((d) => s.has(d));
  if (run([1, 2, 3, 4, 5])) return "Seg a Sex";
  if (run([1, 2, 3, 4, 5, 6])) return "Seg a Sáb";
  return days.map((d) => names[d % 7]).join(", ");
}