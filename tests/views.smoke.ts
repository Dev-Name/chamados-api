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
  const densityOpts = [...doc.querySelectorAll<HTMLSelectElement>("#densitySelect option")];
  check("controle de densidade tem 3 opções", densityOpts.length === 3, densityOpts.length + " opções");
  const dsel = doc.getElementById("densitySelect") as HTMLSelectElement | null;
  if (dsel) {
    dsel.value = "compact";
    dsel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    check("densidade compacta aplicada", dsel.value === "compact");
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

  // ---- Tabela ----
  switchView("table");
  const tbOk = await waitFor(() => doc.querySelectorAll(".tb tbody tr").length > 0);
  check("tabela renderiza linhas", tbOk, doc.querySelectorAll(".tb tbody tr").length + " linhas");
  check("tabela tem cabeçalho ordenável", doc.querySelectorAll(".tb thead th.tb-sort").length >= 5);
  check("tabela tem exportar CSV", !!doc.getElementById("tbCsv"));
  check("tabela tem checkbox de seleção", doc.querySelectorAll(".tb .tb-selbox").length > 0);
  const sortClick = doc.querySelector<HTMLElement>(".tb-sort[data-sort=title]");
  sortClick?.click();
  await sleep(100);
  const titleSort = doc.querySelector<HTMLElement>(".tb-sort[data-sort=title]");
  check("clique em coluna ordena", !!(titleSort && titleSort.textContent?.includes("▲")));

  // dblclick na coluna de status abre o select correto (mapeamento de colunas)
  const anyRow = doc.querySelector<HTMLElement>(".tb tbody tr[data-id]");
  const statusTd = anyRow?.querySelectorAll("td")[6];
  statusTd?.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
  await sleep(100);
  check(
    "dblclick em status abre select de status",
    !!doc.querySelector(".tb tbody tr[data-id] td select.tb-inline"),
    (doc.querySelector(".tb tbody tr[data-id] td select.tb-inline option[selected]") as HTMLOptionElement | null)?.value ?? ""
  );

  // filtro de analista é respeitado na tabela e persiste entre visões
  const fAnalyst = doc.getElementById("f-analyst") as HTMLSelectElement | null;
  if (fAnalyst && fAnalyst.options.length > 1) {
    const aid = fAnalyst.options[1].value;
    const before = doc.querySelectorAll(".tb tbody tr[data-id]").length;
    fAnalyst.value = aid;
    fAnalyst.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(150);
    const rowsFiltered = [...doc.querySelectorAll<HTMLElement>(".tb tbody tr[data-id]")];
    const wrong = rowsFiltered.filter((r) => r.dataset.aid && r.dataset.aid !== aid).length;
    check("filtro de analista aplicado na tabela", before > 0 && rowsFiltered.length <= before && wrong === 0, rowsFiltered.length + " de " + before + " linhas");

    switchView("load");
    await sleep(150);
    switchView("table");
    await sleep(150);
    const rowsBack = [...doc.querySelectorAll<HTMLElement>(".tb tbody tr[data-id]")];
    const wrongBack = rowsBack.filter((r) => r.dataset.aid && r.dataset.aid !== aid).length;
    check("filtro persiste entre visões", wrongBack === 0, rowsBack.length + " linhas");

    fAnalyst.value = "";
    fAnalyst.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await sleep(150);
    check("limpar filtro restaura a tabela", doc.querySelectorAll(".tb tbody tr[data-id]").length >= before);
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