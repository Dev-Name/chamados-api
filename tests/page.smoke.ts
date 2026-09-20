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

async function main() {
  const hasBands = await waitFor(() => dom.window.document.querySelectorAll(".band").length >= 2);
  if (!hasBands) {
    console.error("FALHOU: bandas de analistas não renderizaram");
    console.error("erros:", errors);
    process.exit(1);
  }

  const bands = dom.window.document.querySelectorAll(".band");
  const blocks = dom.window.document.querySelectorAll(".blk");
  const usageLabels = dom.window.document.querySelectorAll(".band-label .bcap");

  if (errors.length) {
    console.error("FALHOU: erros JS na página:", errors);
    process.exit(1);
  }
  if (blocks.length === 0) {
    console.error("FALHOU: nenhum bloco de chamado no calendário");
    process.exit(1);
  }
  if (usageLabels.length === 0) {
    console.error("FALHOU: rótulo de capacidade da semana ausente");
    process.exit(1);
  }

  const summary = dom.window.document.getElementById("summaryBar");
  if (!summary || !/chamados ativos/.test(summary.textContent || "")) {
    console.error("FALHOU: resumo (summaryBar) ausente ou vazio");
    process.exit(1);
  }

  const reportBtn = dom.window.document.getElementById("reportBtn");
  reportBtn?.click();
  const reportOpen = await waitFor(
    () => dom.window.document.getElementById("reportModal").classList.contains("open")
  );
  if (!reportOpen) {
    console.error("FALHOU: modal de relatórios não abriu");
    process.exit(1);
  }
  const repTables = dom.window.document.querySelectorAll("#reportBody table.rep");
  if (repTables.length === 0) {
    console.error("FALHOU: nenhuma tabela no relatório");
    process.exit(1);
  }
  const reportSections = dom.window.document.querySelectorAll("#reportBody .rep-section h3");
  const sectionNames = [...reportSections].map((h) => h.textContent);
  console.log("  Relatórios:", sectionNames.join(" | "));

  console.log(`Página renderizou: ${bands.length} analistas, ${blocks.length} blocos de chamado`);
  [...usageLabels].forEach((l) => console.log("  ", l.textContent));
  console.log("  Resumo:", summary.textContent?.trim().replace(/\s+/g, " "));
  console.log("Teste de frontend OK");
  dom.window.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});