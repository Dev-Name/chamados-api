import assert from "node:assert";

const BASE = "http://localhost:3000";

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try { msg = (await res.json()).error || msg; } catch { /* vazio */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

async function queue(analystId: number) {
  const q = await api("/analysts/" + analystId + "/queue");
  return q.tickets;
}

/** Como api(), porém devolve a Response para inspecionar status de erro. */
async function raw(path: string, method = "GET", body?: unknown) {
  return fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  const analysts = await api("/analysts");
  assert(analysts.length >= 2, "deveria ter ao menos 2 analistas");
  const first = analysts[0];
  assert(
    Array.isArray(first.weeklyCapacityMinutes) && first.weeklyCapacityMinutes.length === 7,
    "analista deveria expor weeklyCapacityMinutes (7 valores Dom..Sáb)"
  );
  assert("lunchStartMinutes" in first && "photo" in first, "analista deveria expor os campos de almoço e foto");

  // cria/atualiza um analista com jornada por dia e almoço
  const created = await api("/analysts", "POST", {
    name: "Teste Semanal",
    weeklyCapacityMinutes: [0, 240, 360, 480, 0, 480, 0],
    lunchStartMinutes: 720,
    lunchEndMinutes: 780,
  });
  assert(JSON.stringify(created.weeklyCapacityMinutes) === "[0,240,360,480,0,480,0]", "weekly deve ser persistido");
  assert(created.workDays.join(",") === "1,2,3,5", "workDays deve derivar dos dias com capacidade");
  assert(created.lunchStartMinutes === 720 && created.lunchEndMinutes === 780, "almoço deve ser persistido");

  const updated = await api("/analysts/" + created.id, "PATCH", {
    weeklyCapacityMinutes: [0, 480, 0, 480, 0, 480, 0],
    lunchStartMinutes: null,
    lunchEndMinutes: null,
  });
  assert(JSON.stringify(updated.weeklyCapacityMinutes) === "[0,480,0,480,0,480,0]", "update weekly");
  assert(updated.lunchStartMinutes === null, "almoço deve ser limpado");
  assert(updated.photo === null, "photo deve existir como null");

  // limpa o analista de teste
  await api("/analysts/" + created.id, "DELETE");

  // remoção de foto via photo: null (contrato usado pelo "Remover foto" do modal)
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const withPhoto = await api("/analysts", "POST", {
    name: "Teste Foto",
    weeklyCapacityMinutes: [0, 480, 480, 480, 480, 480, 0],
    photo: PNG,
  });
  assert(withPhoto.photo === PNG, "photo deveria ser persistida no create");
  const semPhoto = await api("/analysts/" + withPhoto.id, "PATCH", { photo: null });
  assert(semPhoto.photo === null, "photo deveria ser removida com photo: null");
  await api("/analysts/" + withPhoto.id, "DELETE");
  console.log("API + remoção de foto OK");

  const { id: ticketId, estimatedMinutes } = (await queue(1)).find((t: { id: number }) => t.id === 2);
  assert(estimatedMinutes === 240, "ticket #2 deveria ter 240 min de estimativa");

  const dueBefore = await api("/analysts/" + 1 + "/recalculate", "POST", {});
  void dueBefore;

  const qAtual = await queue(1);
  const tAntes = qAtual.find((t: { id: number }) => t.id === ticketId);
  assert(tAntes.dueDate, "chamado deveria ter dueDate antes do teste");

  // Registra 120 min trabalhados (metade do chamado) e recalcula
  await api("/tickets/" + ticketId, "PATCH", { workedMinutes: 120 });
  const tDepois = (await queue(1)).find((t: { id: number }) => t.id === ticketId);
  assert(
    new Date(tDepois.dueDate).getTime() < new Date(tAntes.dueDate).getTime(),
    "dueDate deveria antecipar após registrar tempo trabalhado"
  );

  const horasEconomizadas =
    (new Date(tAntes.dueDate).getTime() - new Date(tDepois.dueDate).getTime()) / 60000;
  if (horasEconomizadas !== 120) {
    console.log(`  obs: antecipou ${horasEconomizadas}min (esperado 120min dentro da jornada)`);
  }

  // Restaura o estado original
  await api("/tickets/" + ticketId, "PATCH", { workedMinutes: 0 });
  const tRestaurado = (await queue(1)).find((t: { id: number }) => t.id === ticketId);
  assert(
    new Date(tRestaurado.dueDate).getTime() === new Date(tAntes.dueDate).getTime(),
    "dueDate deveria voltar ao valor original"
  );

  console.log(`API + workedMinutes OK (#${ticketId}: ${new Date(tAntes.dueDate).toISOString()} → ${new Date(tDepois.dueDate).toISOString()} → restaurado)`);

  // ---- CRUD de categorias (cor/ativo, unicidade e regra de exclusão) ----
  const cats = await api("/categories");
  assert(Array.isArray(cats) && cats.length >= 1, "deveria haver categorias");
  for (const c of cats) {
    assert(typeof c.name === "string" && c.name, "categoria deveria ter name");
    assert(typeof c.cor === "string" && /^#[0-9a-fA-F]{6}$/.test(c.cor), "categoria deveria ter cor hex #RRGGBB");
    assert(typeof c.ativo === "boolean", "categoria deveria ter ativo");
    assert(typeof c._count?.tickets === "number", "categoria deveria expor _count.tickets");
  }

  const unique = "Teste Categoria " + Date.now();
  const nova = await api("/categories", "POST", { name: unique, cor: "#22c55e" });
  assert(nova.cor === "#22c55e" && nova.ativo === true, "create deveria persistir cor e ativo");

  const dup = await raw("/categories", "POST", { name: unique, cor: "#ef4444" });
  assert(dup.status === 409, "nome duplicado deveria retornar 409 (real: " + dup.status + ")");

  const editada = await api("/categories/" + nova.id, "PATCH", { cor: "#8b5cf6", ativo: false });
  assert(editada.cor === "#8b5cf6" && editada.ativo === false, "patch deveria atualizar cor/ativo");

  const reativada = await api("/categories/" + nova.id, "PATCH", { ativo: true });
  assert(reativada.ativo === true, "patch deveria reativar a categoria");

  const emUsoCat = cats.find((c: { _count?: { tickets: number } }) => (c._count?.tickets ?? 0) > 0);
  assert(emUsoCat, "pelo menos uma categoria deveria estar em uso");
  const emUso = await raw("/categories/" + (emUsoCat as { id: number }).id, "DELETE");
  assert(emUso.status === 409, "delete de categoria em uso deveria retornar 409 (real: " + emUso.status + ")");
  const emUsoJson = (await emUso.json()) as { error?: string; message?: string };
  assert(
    /inativ/i.test(emUsoJson.error || emUsoJson.message || ""),
    "mensagem do 409 deveria sugerir inativação"
  );

  await api("/categories/" + nova.id, "DELETE");
  const semUso = await api("/categories");
  assert(
    !semUso.some((c: { id: number }) => c.id === nova.id),
    "categoria recém-criada deveria ser removida"
  );
  console.log("API + CRUD categorias OK");
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});