/**
 * Serialização de chamados com múltiplos analistas (m2m).
 *
 * A relação `assignees` é incluída nas queries e convertida para o formato
 * `analystIds` (array de ids) exposto na API. A relação bruta é removida
 * para manter a resposta limpa e consistente.
 */

type Assignee = { id: number };

/** Chamado com o array de atribuição já incluído. */
export type TicketWithAssignees = { assignees: Assignee[] };

/**
 * Converte um chamado (com `assignees` incluído) para o DTO público:
 * `analystIds` no lugar de `assignees`.
 */
export function ticketDTO<T extends TicketWithAssignees>(
  t: T
): Omit<T, "assignees"> & { analystIds: number[] } {
  const { assignees, ...rest } = t;
  return { ...rest, analystIds: assignees.map((a) => a.id).sort((a, b) => a - b) };
}

/**
 * Converte um analista com fila de chamados embutida, aplicando o DTO de
 * chamado em cada ticket da fila.
 */
export function analystWithQueueDTO<T extends { tickets: TicketWithAssignees[] }>(
  a: T
): Omit<T, "tickets"> & { tickets: Array<Omit<T["tickets"][number], "assignees"> & { analystIds: number[] }> } {
  const { tickets, ...rest } = a;
  return { ...rest, tickets: tickets.map(ticketDTO) };
}