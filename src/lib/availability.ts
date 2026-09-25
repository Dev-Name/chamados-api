import type { Analyst, AnalystAbsence } from "@prisma/client";

/**
 * Helpers de disponibilidade de analistas.
 *
 * O desligamento (data_desligamento) é gravado como date-only à meia-noite
 * UTC: a comparação é feita sempre por string ISO da data (YYYY-MM-DD) para
 * evitar efeitos de fuso horário.
 *
 * As ausências (AnalystAbsence) guardam instantes absolutos
 * (data_hora_inicio/data_hora_fim), então a verificação usa timestamps reais
 * (ms desde a epoch) contra o instante atual `now()`.
 */

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isoDateOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Analista tratado como desligado quando data_desligamento <= data de hoje. */
export function isTerminated(dataDesligamento: Date | null, now: Date = new Date()): boolean {
  if (!dataDesligamento) return false;
  return isoDateOf(dataDesligamento) <= todayIso(now);
}

/** Analista ausente quando `when` cai dentro de algum intervalo [inicio, fim]. */
export function isOnAbsenceAt(
  absences: Pick<AnalystAbsence, "data_hora_inicio" | "data_hora_fim">[],
  when: Date = new Date()
): boolean {
  const t = when.getTime();
  return absences.some((a) => a.data_hora_inicio.getTime() <= t && t <= a.data_hora_fim.getTime());
}

/** Disponível para novas atribuições: não desligado e fora de ausência/licença ativa. */
export function isAnalystAvailable(
  dataDesligamento: Date | null,
  absences: Pick<AnalystAbsence, "data_hora_inicio" | "data_hora_fim">[],
  when: Date = new Date()
): boolean {
  return !isTerminated(dataDesligamento, when) && !isOnAbsenceAt(absences, when);
}

export function fmtBrazilDate(d: Date): string {
  return isoDateOf(d).split("-").reverse().join("/");
}

/** "25/09/2026" no fuso local do servidor (para exibir datas de ausências corretamente). */
export function fmtLocalDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** "25/09/2026 14:00" no fuso do servidor (apenas para mensagens/validações). */
export function fmtBrazilDateTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

// Reexporta o tipo para uso conveniente em rotas
export type { Analyst, AnalystAbsence };