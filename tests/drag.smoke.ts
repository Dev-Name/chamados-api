import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:3000";

async function main() {
  const orderedIds = async (analystId: number) => {
    const q = await (await fetch(`${BASE}/analysts/${analystId}/queue`)).json();
    return q.tickets
      .filter((t: { status: string }) => t.status !== "COMPLETED")
      .sort((a: any, b: any) => a.priority - b.priority || a.position - b.position || a.id - b.id)
      .map((t: { id: number }) => t.id);
  };
  const original1 = await orderedIds(1);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text()); });
  const reorderBodies: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/reorder")) {
      try { reorderBodies.push(r.postData()); } catch { /* ignore */ }
    }
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  // 1) Clique numa célula vazia cria chamado com analista pré-preenchido
  const cells = await page.$$("#band-2 .day");
  const thu = cells[3];
  await thu.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await new Promise((r) => setTimeout(r, 300));
  const thr = await thu.boundingBox();
  await page.mouse.click(thr!.x + thr!.width / 2, thr!.y + 100);
  await new Promise((r) => setTimeout(r, 400));
  const modalOpen = await page.evaluate(() =>
    document.getElementById("ticketModal").classList.contains("open"));
  const analystPreset = await page.evaluate(
    () => document.querySelector<HTMLInputElement>("#t-assignees input:checked")?.value ?? ""
  );
  console.log("click-create:", modalOpen ? "modal aberto" : "FALHOU", "| analista preset:", analystPreset);
  await page.evaluate(() => (document.querySelector('[data-close="ticketModal"]') as HTMLElement).click());
  await new Promise((r) => setTimeout(r, 300));

  // 2) Drag do chamado #2 (Ter, base) para Qua no mesmo analista
  const blk = await page.$('#band-1 .blk[data-id="2"]');
  await blk!.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await new Promise((r) => setTimeout(r, 300));
  const br = await blk.boundingBox();
  const cellsB = await page.$$("#band-1 .day");
  const wedEl = cellsB[2];
  const wed = await wedEl.boundingBox();
  await page.mouse.move(br!.x + br!.width / 2, br!.y + br!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      wed!.x + wed!.width / 2,
      wed!.y + br!.height / 2 + (i - 4) * 2,
      { steps: 1 }
    );
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1500));

  const captured = reorderBodies.length
    ? JSON.parse(String(reorderBodies[0]))
    : null;
  const movedOk =
    captured && Array.isArray(captured.order) && captured.order.length === original1.length;
  console.log("drag reorder:", movedOk ? `POST /reorder com ${captured.order.length} ids` : "FALHOU (sem request)");

  // Estado do banco após o drag
  const after1 = await orderedIds(1);
  console.log("ordem original:", original1.join(","));
  console.log("ordem pós-drag:", after1.join(","));

  // Restaura o estado original
  await fetch(`${BASE}/analysts/1/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order: original1 }),
  });
  const restored = await orderedIds(1);
  console.log("ordem restaurada:", restored.join(","));

  console.log("erros JS:", errors.length ? errors : "nenhum");
  const ok =
    modalOpen && String(analystPreset) === "2" && movedOk &&
    JSON.stringify(restored) === JSON.stringify(original1) && errors.length === 0;
  console.log(ok ? "TESTE FUNCIONAL OK" : "TESTE FUNCIONAL COM PROBLEMAS");
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});