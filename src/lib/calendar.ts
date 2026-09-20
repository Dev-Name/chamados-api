import dayjs, { Dayjs } from "dayjs";

export const MILLIS_PER_MINUTE = 60_000;

/** Início nominal da jornada de trabalho (09:00), usado como âncora dos horários. */
export const WORKDAY_START_HOUR = 9;
export const WORKDAY_START_MINUTES = WORKDAY_START_HOUR * 60;

export interface LunchWindow {
  start: number;
  end: number;
}

export interface AnalystCalendarOptions {
  /**
   * Capacidade diária em minutos por dia da semana (getDay(): 0=Dom..6=Sáb).
   * Quando presente, define os dias úteis como os dias com capacidade > 0 e
   * "desliga" dailyCapacityMinutes/workDays do construtor legado.
   * É a duração do expediente (entrada→saída), não o saldo líquido de almoço.
   */
  capacityByDay?: number[];
  /**
   * Início do expediente por dia da semana, em minutos desde a meia-noite
   * (getDay(): 0=Dom..6=Sáb). Valores ausentes/negativos caem no padrão 09:00.
   */
  startByDay?: number[];
  /**
   * Almoço por dia (7 valores, 0=Dom..6=Sáb). -1/ausente = sem intervalo naquele dia.
   * Quando os arrays têm length 7, prevalecem sobre o par legado.
   */
  lunchStartByDay?: number[];
  lunchEndByDay?: number[];
  /** Par legado: mesmo intervalo de almoço em todos os dias úteis. */
  lunchStartMinutes?: number | null;
  lunchEndMinutes?: number | null;
}

type Interval = { start: number; end: number };

/**
 * Calendário de capacidade de um analista.
 *
 * Simula a jornada útil: respeita os dias úteis configurados (workDays) e a
 * capacidade diária em minutos (dailyCapacityMinutes ou capacityByDay por dia).
 * O tempo que não couber no dia "transborda" para o próximo dia útil.
 *
 * A capacidade é a duração do expediente. O almoço, quando cai dentro do
 * expediente, não é alocado: o trabalho para no início e retoma no fim.
 * Ex.: 09:00–17:00 (480) com almoço 12:00–13:00 => 420 min produtivos (09–12 e 13–17).
 */
export class AnalystCalendar {
  private readonly capacityOf: (dow: number) => number;
  private readonly startOf: (dow: number) => number;
  private readonly lunchOf: (dow: number) => LunchWindow | null;

  // Cursor de agendamento: dia corrente (sempre dia útil) + minutos produtivos já usados.
  private day: Dayjs;
  private usedMinutes: number;

  constructor(
    workDays: number[],
    dailyCapacityMinutes: number,
    reference?: Date,
    options?: AnalystCalendarOptions
  ) {
    const capacityByDay = options?.capacityByDay;
    if (capacityByDay) {
      if (capacityByDay.length !== 7 || capacityByDay.some((c) => !Number.isFinite(c) || c < 0)) {
        throw new Error("capacityByDay deve ter 7 valores (0=Dom..6=Sáb) de minutos >= 0");
      }
      if (!capacityByDay.some((c) => c > 0)) {
        throw new Error("capacityByDay precisa de ao menos um dia com capacidade > 0");
      }
      const byDow = capacityByDay.map((c) => Math.floor(c));
      this.capacityOf = (dow) => byDow[dow] ?? 0;
    } else {
      if (dailyCapacityMinutes <= 0) {
        throw new Error("dailyCapacityMinutes deve ser maior que zero");
      }
      if (!workDays.length) {
        throw new Error("workDays não pode ser vazio (o analista precisa de ao menos um dia útil)");
      }
      const days = new Set(workDays);
      this.capacityOf = (dow) => (days.has(dow) ? dailyCapacityMinutes : 0);
    }

    const base = dayjs(reference ?? new Date()).startOf("day");
    this.startOf = buildStartOf(options?.startByDay);
    this.lunchOf = buildLunchOf(options);
    this.day = this.beginOfWorkday(this.nextWorkdayAtOrAfter(base));
    this.usedMinutes = 0;
  }

  /** Duração do expediente (em minutos) para um dia da semana (0=Dom..6=Sáb). */
  capacityFor(dow: number): number {
    return this.capacityOf(dow);
  }

  /** Minutos alocáveis no dia (expediente menos o almoço que cai dentro dele). */
  productiveCapacityFor(dow: number): number {
    return this.workIntervals(dow).reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  }

  isWorkDay(date: Dayjs | Date): boolean {
    return this.capacityOf(dayjs(date).get("day")) > 0;
  }

  /** Próximo dia útil em ou após `date`. */
  nextWorkdayAtOrAfter(date: Dayjs | Date): Dayjs {
    const cursor = dayjs(date).startOf("day");
    let probe = cursor;
    let guard = 0;
    while (!this.isWorkDay(probe) || this.productiveCapacityFor(probe.get("day")) <= 0) {
      probe = probe.add(1, "day");
      if (++guard > 14) {
        throw new Error("Nenhum dia com minutos alocáveis (verifique expediente e almoço)");
      }
    }
    return probe;
  }

  /**
   * Ajusta o cursor para que o próximo trabalho comece exatamente em `date`
   * (usado quando uma dependência técnica empurra o início para depois da
   * capacidade livre disponível).
   *
   * O horário de `date` é interpretado em relação ao expediente:
   * - horário dentro de um intervalo de trabalho => começa ali mesmo;
   * - horário no almoço => começa ao retomar o expediente;
   * - horário no fim/excedendo a jornada, ou antes do início => próximo dia útil;
   * - fora de um dia útil => começa no próximo dia útil.
   */
  alignTo(date: Dayjs | Date): void {
    const target = dayjs(date);
    if (!this.isWorkDay(target)) {
      this.day = this.beginOfWorkday(this.nextWorkdayAtOrAfter(target));
      this.usedMinutes = 0;
      return;
    }

    const dow = target.get("day");
    const start = this.startOf(dow);
    const wall = target.hour() * 60 + target.minute();
    if (wall < start) {
      this.day = this.beginOfWorkday(this.nextWorkdayAtOrAfter(target.add(1, "day")));
      this.usedMinutes = 0;
      return;
    }

    const used = workMinutesAt(this.workIntervals(dow), wall);
    if (used >= this.productiveCapacityFor(dow)) {
      this.day = this.beginOfWorkday(this.nextWorkdayAtOrAfter(target.add(1, "day")));
      this.usedMinutes = 0;
    } else {
      this.day = this.beginOfWorkday(target);
      this.usedMinutes = used;
    }
  }

  /** Próximo instante disponível para iniciar trabalho. */
  nextAvailableAt(): Dayjs {
    this.advanceWhileFullOrNonWorkday();
    return this.wallDate(this.nextStartMinutes());
  }

  /**
   * Aloca `minutes` na agenda a partir do próximo instante disponível.
   * Retorna o instante em que o trabalho termina (dueDate).
   */
  allocate(minutes: number): Dayjs {
    if (minutes <= 0) {
      throw new Error("estimatedMinutes deve ser maior que zero");
    }

    let remaining = minutes;
    this.advanceWhileFullOrNonWorkday();

    while (remaining > 0) {
      const free = this.productiveCapacityFor(this.day.get("day")) - this.usedMinutes;
      if (remaining <= free) {
        this.usedMinutes += remaining;
        remaining = 0;
      } else {
        remaining -= free;
        this.day = this.beginOfWorkday(this.nextWorkdayAtOrAfter(this.day.add(1, "day")));
        this.usedMinutes = 0;
      }
    }

    return this.wallDate(this.dueMinutes());
  }

  private workIntervals(dow: number): Interval[] {
    const cap = this.capacityOf(dow);
    if (cap <= 0) return [];
    const start = this.startOf(dow);
    const end = start + cap;
    const lunch = clipLunch(this.lunchOf(dow), start, end);
    if (!lunch) return [{ start, end }];
    const intervals: Interval[] = [];
    if (lunch.start > start) intervals.push({ start, end: lunch.start });
    if (lunch.end < end) intervals.push({ start: lunch.end, end });
    return intervals;
  }

  private nextStartMinutes(): number {
    return nextStartMinutes(this.workIntervals(this.day.get("day")), this.usedMinutes);
  }

  private dueMinutes(): number {
    return dueMinutes(this.workIntervals(this.day.get("day")), this.usedMinutes);
  }

  private wallDate(minutesFromMidnight: number): Dayjs {
    return this.day
      .startOf("day")
      .set("hour", Math.floor(minutesFromMidnight / 60))
      .set("minute", minutesFromMidnight % 60)
      .set("second", 0)
      .set("millisecond", 0);
  }

  private advanceWhileFullOrNonWorkday(): void {
    while (
      !this.isWorkDay(this.day) ||
      this.usedMinutes >= this.productiveCapacityFor(this.day.get("day"))
    ) {
      this.day = this.beginOfWorkday(this.nextWorkdayAtOrAfter(this.day.add(1, "day")));
      this.usedMinutes = 0;
    }
  }

  private beginOfWorkday(date: Dayjs): Dayjs {
    const start = this.startOf(date.get("day"));
    return date
      .set("hour", Math.floor(start / 60))
      .set("minute", start % 60)
      .set("second", 0)
      .set("millisecond", 0);
  }
}

/**
 * Constrói o seletor de início de expediente por dia. Sem configuração válida,
 * todos os dias começam em WORKDAY_START_MINUTES (09:00).
 */
function buildStartOf(startByDay?: number[]): (dow: number) => number {
  if (!startByDay || startByDay.length !== 7) return () => WORKDAY_START_MINUTES;
  const starts = startByDay.map((m) =>
    Number.isFinite(m) && m >= 0 && m < 24 * 60 ? Math.floor(m) : WORKDAY_START_MINUTES
  );
  return (dow) => starts[dow] ?? WORKDAY_START_MINUTES;
}

function buildLunchOf(options?: AnalystCalendarOptions): (dow: number) => LunchWindow | null {
  const byStart = options?.lunchStartByDay;
  const byEnd = options?.lunchEndByDay;
  if (byStart && byEnd && byStart.length === 7 && byEnd.length === 7) {
    return (dow) => windowFromPair(byStart[dow], byEnd[dow]);
  }
  const legacy = windowFromPair(options?.lunchStartMinutes, options?.lunchEndMinutes);
  return () => legacy;
}

function windowFromPair(start: number | null | undefined, end: number | null | undefined): LunchWindow | null {
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < 0) return null;
  if (end <= start) return null;
  return { start: Math.floor(start), end: Math.floor(end) };
}

function clipLunch(lunch: LunchWindow | null, shiftStart: number, shiftEnd: number): LunchWindow | null {
  if (!lunch) return null;
  const start = Math.max(lunch.start, shiftStart);
  const end = Math.min(lunch.end, shiftEnd);
  if (end <= start) return null;
  return { start, end };
}

function workMinutesAt(intervals: Interval[], wall: number): number {
  let used = 0;
  for (const iv of intervals) {
    if (wall <= iv.start) return used;
    if (wall < iv.end) return used + (wall - iv.start);
    used += iv.end - iv.start;
  }
  return used;
}

function nextStartMinutes(intervals: Interval[], used: number): number {
  let left = used;
  for (const iv of intervals) {
    const len = iv.end - iv.start;
    if (left < len) return iv.start + left;
    left -= len;
  }
  return intervals[intervals.length - 1]?.end ?? 0;
}

function dueMinutes(intervals: Interval[], used: number): number {
  if (used <= 0) return intervals[0]?.start ?? 0;
  let left = used;
  for (const iv of intervals) {
    const len = iv.end - iv.start;
    if (left <= len) return iv.start + left;
    left -= len;
  }
  return intervals[intervals.length - 1]?.end ?? 0;
}
