import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const BASE = "http://localhost:3000";
const html = readFileSync(join(__dirname, "..", "public", "index.html"), "utf8");

const errors: string[] = [];

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: BASE + "/",
  pretendToBeVisual: true,
  beforeParse(window) {
    (window as unknown as { fetch: typeof fetch }).fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      typeof input === "string" && input.startsWith("/")
        ? fetch(BASE + input, init)
        : fetch(input as RequestInfo, init);
    window.addEventListener("error", (e) => errors.push(e.message));
    window.addEventListener("unhandledrejection", (e: unknown) => errors.push("rej: " + String((e as { reason?: unknown }).reason)));
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await sleep(150);
  }
  return false;
}

let failures = 0;
function check(name: string, ok: boolean, extra = ""): void {
  console.log((ok ? "  ok  " : "  FALHOU  ") + name + (extra ? " — " + extra : ""));
  if (!ok) failures++;
}

async function main() {
  const doc = dom.window.document;
  const hasBands = await waitFor(() => doc.querySelectorAll(".band").length >= 2);
  if (!hasBands) {
    console.error("FALHOU: bandas não renderizaram", errors);
    process.exit(1);
  }
  check("país carregou com bandas", true, doc.querySelectorAll(".band").length + " analistas");
  if (errors.length) check("sem erros JS", false, errors.join(" | "));

  // ---- Grade base: hierarquia visual + tooltips ----
  const firstBlk = doc.querySelector<HTMLElement>(".blk");
  check("blocos com title (tooltip acessível)", !!firstBlk?.title, firstBlk?.title?.slice(0, 60));
  check("cartão tem selo de status", doc.querySelectorAll(".blk .st-badge").length > 0);
  check("cartão tem pill de prioridade", doc.querySelectorAll(".blk .bt-pill").length > 0);
  check("menu por analista destravelado", doc.querySelectorAll(".band .bmenu").length >= 2);

  const dayCells = () => doc.querySelectorAll(".band .day").length;
  check("semana padrão tem 7 colunas", dayCells() === doc.querySelectorAll(".band").length * 7, dayCells() + " células");

  // toggle fim de semana
  const weekendToggle = doc.getElementById("weekendToggle") as HTMLButtonElement | null;
  if (weekendToggle) {
    weekendToggle.click();
    await waitFor(() => dayCells() === doc.querySelectorAll(".band").length * 5);
    check("ocultar fim de semana reduz para 5 colunas", dayCells() === doc.querySelectorAll(".band").length * 5, dayCells() + " células");
    weekendToggle.click();
    await waitFor(() => dayCells() === doc.querySelectorAll(".band").length * 7);
  } else {
    check("existe botão fim de semana", false);
  }

  // densidade
  const densityOpts = [...doc.querySelectorAll<HTMLElement>("#densityMenu .cs-option")];
  check("controle de densidade tem 3 opções", densityOpts.length === 3, densityOpts.length + " opções");
  const dopt = doc.querySelector<HTMLElement>("#densityMenu .cs-option[data-value=compact]");
  const dlabel = doc.getElementById("densityLabel");
  if (dopt && dlabel) {
    dopt.click();
    check("densidade compacta aplicada", dlabel.textContent?.includes("Compacto") ?? false);
  } else {
    check("controle de densidade existe", false);
  }

  // ---- Kanban ----
  function switchView(view: string): void {
    const btn = doc.querySelector<HTMLElement>(`#viewSwitch [data-view=${view}]`);
    btn?.click();
  }
  switchView("kanban");
  await sleep(200);
  const kbOk = await waitFor(() => doc.querySelectorAll(".kb-board .kb-card").length > 0);
  check("kanban renderiza cartões arrastáveis", kbOk, doc.querySelectorAll(".kb-card").length + " cartões");
  check("kanban tem 4 colunas de status", doc.querySelectorAll(".kb-col").length === 4, doc.querySelectorAll(".kb-col").length + " colunas");
  check("cartão kanban é draggable", doc.querySelectorAll<HTMLElement>(".kb-card[draggable=true]").length > 0);
  const swim = doc.getElementById("kbSwimTgl") as HTMLInputElement | null;
  if (swim) {
    swim.checked = true;
    swim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const swimOk = await waitFor(() => doc.querySelectorAll(".kb-lane").length > 0);
    check("kanban com raias por analista", swimOk, doc.querySelectorAll(".kb-lane").length + " raias");
  }

  // ---- Chamados (listagem igual à tela de Analistas) ----
  const ticketsMenu = doc.getElementById("ticketsMenu");
  if (ticketsMenu) {
    ticketsMenu.click();
    const lOpen = await waitFor(() => doc.getElementById("ticketsModal").classList.contains("open"));
    check("menu Chamados abre a listagem", lOpen);
    const cards = doc.querySelectorAll("#ticketsList .ticket-card");
    check("listagem renderiza chamados como cartões", cards.length > 0, cards.length + " chamados");
    check("cada chamado tem ação editar", doc.querySelectorAll("#ticketsList [data-t-edit]").length > 0);
    check("cada chamado tem ação excluir", doc.querySelectorAll("#ticketsList [data-t-del]").length > 0);
    check("cada chamado mostra prazo previsto", doc.querySelectorAll("#ticketsList .t-card-meta").length > 0);

    const firstEdit = doc.querySelector<HTMLElement>("#ticketsList [data-t-edit]");
    firstEdit?.click();
    const tEditOpen = await waitFor(() => doc.getElementById("ticketModal").classList.contains("open"));
    check("editar abre o modal do chamado", tEditOpen);
    (doc.querySelector('[data-close="ticketModal"]') as HTMLElement)?.click();
    await sleep(100);
    (doc.querySelector('[data-close="ticketsModal"]') as HTMLElement)?.click();
    await sleep(100);
    check("modal de chamados fecha", !doc.getElementById("ticketsModal").classList.contains("open"));
  } else {
    check("existe menu Chamados", false);
  }

  // ---- Categorias (menu + listagem + editor com cores) ----
  const catMenu = doc.getElementById("categoriesMenu");
  if (catMenu) {
    catMenu.click();
    const cOpen = await waitFor(() => doc.getElementById("categoriesModal").classList.contains("open"));
    check("menu Categorias abre a listagem", cOpen);
    const catRows = doc.querySelectorAll("#categoriesList .an-row");
    check("listagem renderiza categorias", catRows.length > 0, catRows.length + " categorias");
    check(
      "cada categoria tem badge de cor",
      doc.querySelectorAll("#categoriesList .cat-flag[style*=background]").length === catRows.length
    );
    check(
      "ações editar/excluir por categoria",
      doc.querySelectorAll("#categoriesList [data-cat-edit]").length === catRows.length &&
        doc.querySelectorAll("#categoriesList [data-cat-del]").length === catRows.length
    );

    const addBtn = doc.getElementById("cat-add") as HTMLElement | null;
    addBtn?.click();
    const addOpen = await waitFor(() => doc.getElementById("categoryModal").classList.contains("open"));
    check("+ Nova categoria abre o editor", addOpen);
    const colorOpts = doc.querySelectorAll<HTMLOptionElement>("#cat-color option[data-color]");
    check("select de cores com bolinhas no item", colorOpts.length > 0, colorOpts.length + " cores");
    check(
      "bolinha visível no seletor",
      doc.querySelectorAll("#categoryModal .cs-swatch").length > 0,
      doc.querySelectorAll("#categoryModal .cs-swatch").length + " bolinhas"
    );
    (doc.querySelector('[data-close="categoryModal"]') as HTMLElement)?.click();
    await sleep(100);

    const firstEdit = doc.querySelector<HTMLElement>("#categoriesList [data-cat-edit]");
    firstEdit?.click();
    const editOpen = await waitFor(() => doc.getElementById("categoryModal").classList.contains("open"));
    const nameInput = doc.getElementById("cat-name") as HTMLInputElement | null;
    check("editar abre o modal e preenche o nome", editOpen && (nameInput?.value ?? "").length > 0, (nameInput?.value ?? "").slice(0, 40));
    (doc.querySelector('[data-close="categoryModal"]') as HTMLElement)?.click();
    await sleep(100);
    (doc.querySelector('[data-close="categoriesModal"]') as HTMLElement)?.click();
    await sleep(100);
    check("modais de categorias fecham", !doc.getElementById("categoriesModal").classList.contains("open"));
  } else {
    check("existe menu Categorias", false);
  }

  // volta para a semana para validar o filtro de analista nas bandas
  switchView("week");
  await waitFor(() => doc.querySelectorAll(".band").length >= 2);

  // filtro de analista é respeitado na semana (bandas dos analistas)
  const fAnalyst = doc.getElementById("f-analyst") as HTMLSelectElement | null;
  if (fAnalyst && fAnalyst.options.length > 1) {
    const aid = fAnalyst.options[1].value;
    const before = doc.querySelectorAll(".band").length;
    fAnalyst.value = aid;
    fAnalyst.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(150);
    const rowsFiltered = [...doc.querySelectorAll<HTMLElement>(".band")];
    const wrong = rowsFiltered.filter((r) => r.dataset.a && r.dataset.a !== aid).length;
    check("filtro de analista aplicado na semana", before > 0 && rowsFiltered.length < before && wrong === 0, rowsFiltered.length + " de " + before + " bandas");

    fAnalyst.value = "";
    fAnalyst.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(150);
    check("limpar filtro restaura a semana", doc.querySelectorAll(".band").length >= before);
  } else {
    check("existe select de analista", false);
  }

  // ---- Carga ----
  switchView("load");
  const ldOk = await waitFor(() => doc.querySelectorAll(".ld tbody .ld-c").length > 0);
  check("carga renderiza matriz", ldOk, doc.querySelectorAll(".ld tbody .ld-c").length + " células");
  check("carga tem total por analista", doc.querySelectorAll(".ld .ld-sum").length >= 2);

  // ---- Gantt ----
  switchView("gantt");
  const gtOk = await waitFor(() => doc.querySelectorAll(".gbar").length > 0);
  check("gantt renderiza barras", gtOk, doc.querySelectorAll(".gbar").length + " barras");
  check("gantt tem linhas de analista", doc.querySelectorAll(".g-lane-label").length >= 2);
  check("gantt tem escala com 3 opções", doc.querySelectorAll(".g-scale-btn").length === 3);
  const dayScale = doc.querySelector<HTMLElement>(".g-scale-btn[data-scale=day]");
  dayScale?.click();
  await sleep(100);
  check("troca de escala re-renderiza", doc.querySelectorAll<HTMLElement>(".g-scale-btn[data-scale=day].active").length === 1);

  // ---- volta para semana ----
  doc.querySelector<HTMLElement>("#viewSwitch [data-view=week]")?.click();
  const backOk = await waitFor(() => doc.querySelectorAll(".band").length >= 2);
  check("volta para a semana", backOk, doc.querySelectorAll(".band").length + " bandas");

  // ---- teclado ----
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "g" }));
  const gKeyOk = await waitFor(() => doc.querySelectorAll(".gbar").length > 0);
  check("atalho G muda para gantt", gKeyOk);
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "w" }));
  const wKeyOk = await waitFor(() => doc.querySelectorAll(".band").length >= 2);
  check("atalho W volta para semana", wKeyOk);

  if (errors.length) {
    console.error("Erros JS na página:", errors);
    failures += errors.length;
  }

  console.log(failures === 0 ? "Teste de visões OK" : failures + " verificação(ões) falharam");
  dom.window.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});