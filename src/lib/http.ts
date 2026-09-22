/** Converte param de rota para inteiro positivo ou retorna null. */
export function parseId(param: string): number | null {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}