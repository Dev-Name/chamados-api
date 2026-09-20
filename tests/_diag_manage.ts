import { readFileSync } from "node:fs"; import { join } from "node:path"; import { JSDOM } from "jsdom";
const BASE = "http://localhost:3000";
const html = readFileSync(join(process.cwd(), "public", "index.html"), "utf8");
const errors: string[] = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously", url: BASE + "/", pretendToBeVisual: true,
  beforeParse(w) {
    (w as any).fetch = (i: string | RequestInfo | URL, init?: RequestInit) =>
      typeof i === "string" && i.startsWith("/") ? fetch(BASE + i, init) : fetch(i as RequestInfo, init);
    w.addEventListener("error", (e: ErrorEvent) => errors.push(e.message));
  },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(p: () => boolean, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (p()) return true; await sleep(150); } return false; }
(async () => {
  const { window, document } = dom.window;
  // gatilho REAL: botao id=manageAnalysts (abre modal + renderAnalysts)
  const btn = document.getElementById("manageAnalysts");
  if (!btn) { console.error("sem #manageAnalysts"); process.exit(1); }
  (btn as HTMLElement).click();
  const opened = await waitFor(() => document.querySelectorAll(".an-row.brief").length >= 2);
  console.log("apos click — .an-row.brief:", document.querySelectorAll(".an-row.brief").length, "| erros:", JSON.stringify(errors));
  const listEl = document.getElementById("analystsList");
  console.log("list#innerHTML(primeiros 200):", (listEl?.innerHTML || "").slice(0, 200));
  window.close();
  process.exit(opened ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
