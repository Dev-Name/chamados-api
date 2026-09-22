import puppeteer from "puppeteer-core";

const EXE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:3000";

async function main() {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.waitForSelector(".band");

  const out: Record<string, unknown> = { errors: [] };

  const audit = async (label: string) => {
    out["audit_" + label] = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const issues: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > vw + 2) issues.push("page-h-scroll:" + doc.scrollWidth + ">" + vw);
      const topbar = document.querySelector(".topbar");
      if (topbar) { const r = topbar.getBoundingClientRect(); if (r.right > vw + 2) issues.push("topbar-over:" + r.right.toFixed(0)); }
      const hdr = document.querySelector("header .actions");
      if (hdr) { const r = hdr.getBoundingClientRect(); if (r.right > vw + 2) issues.push("header-actions-over:" + r.right.toFixed(0)); }
      const sum = document.getElementById("summaryBar");
      if (sum && sum.scrollWidth > sum.clientWidth + 2) issues.push("summary-inner:" + sum.scrollWidth + ">" + sum.clientWidth);
      const blkSel = ".grid-row.band .day:not(.idle) .blk, .dayrow .day:not(.idle) .blk";
      document.querySelectorAll(blkSel).forEach((b) => {
        const dr = (b.closest(".day") as HTMLElement).getBoundingClientRect();
        const br = b.getBoundingClientRect();
        if (br.right - dr.right > 2) issues.push("blk-right-fold");
        if (br.left - dr.left < -2) issues.push("blk-left-fold");
        if (br.bottom - dr.bottom > 2) issues.push("blk-bottom-fold");
      });
      document.querySelectorAll(".dhead").forEach((dh) => {
        const e = dh as HTMLElement;
        if (e.scrollWidth > e.clientWidth + 2) issues.push("dhead-inner:" + e.scrollWidth + ">" + e.clientWidth);
      });
      document.querySelectorAll(".band-label").forEach((bl) => {
        const e = bl as HTMLElement;
        const r = e.getBoundingClientRect();
        if (e.scrollWidth > r.width + 2) issues.push("bandlabel-inner:" + e.scrollWidth + ">" + r.width.toFixed(0));
      });
      document.querySelectorAll(".mday:not(.out)").forEach((md) => {
        (md as HTMLElement).querySelectorAll(".mc").forEach((mc) => {
          const mr = (md as HTMLElement).getBoundingClientRect();
          const cr = (mc as HTMLElement).getBoundingClientRect();
          if (cr.right - mr.right > 2 || cr.left < mr.left - 2) issues.push("month-chip-fold");
        });
      });
      document.querySelectorAll(".mtile").forEach((t) => {
        const e = t as HTMLElement;
        if (e.scrollWidth > e.clientWidth + 2) issues.push("mtile-inner:" + e.scrollWidth + ">" + e.clientWidth);
      });
      const foot = document.querySelector(".side-foot");
      if (foot) { const r = foot.getBoundingClientRect(); if (r.right > vw + 2 || r.bottom > vh + 2) issues.push("sidefoot-over"); }
      return issues;
    });
  };

  const checkFitAt = async (w: number) => {
    await page.setViewport({ width: w, height: 900 });
    await sleep(150);
    out["fit_" + w] = await page.evaluate(() => {
      const vw = window.innerWidth;
      const issues: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > vw + 2) issues.push("page-h-scroll:" + doc.scrollWidth + ">" + vw);
      const hdr = document.querySelector("header .actions");
      if (hdr) { const r = hdr.getBoundingClientRect(); if (r.right > vw + 2) issues.push("header-actions-over"); }
      return { view: document.getElementById("weekTitle")?.textContent, issues };
    });
  };
  await checkFitAt(1280);
  await checkFitAt(1024);
  await page.setViewport({ width: 1440, height: 900 });
  await sleep(150);

  out.uiToggles = await page.evaluate(() => ({
    filtersHidden: !document.querySelector("#filterBar").classList.contains("open"),
    legendHidden: !document.querySelector("#legendPop").classList.contains("show"),
  }));
  await page.click("#filterToggle");
  await sleep(80);
  out.filtersToggle = await page.evaluate(() => ({
    nowClosedByToggle: !document.querySelector("#filterBar").classList.contains("open"),
  }));
  await page.click("#filterToggle");

  // --- sidebar cabe no viewport ---
  out.sidebar = await page.evaluate(() => {
    const r = (document.getElementById("side") as HTMLElement).getBoundingClientRect();
    const main = document.querySelector("main") as HTMLElement;
    const ml = parseFloat(getComputedStyle(main).marginLeft);
    return {
      width: Math.round(r.width), right: Math.round(r.right), fits: r.right <= window.innerWidth + 2,
      mainOffset: Math.round(ml), aligns: Math.abs(r.width - ml) < 2,
    };
  });

  // --- semana ---
  out.week = await page.evaluate(() => ({
    bands: document.querySelectorAll(".band").length,
    blks: document.querySelectorAll(".blk").length,
    dheads: document.querySelectorAll(".dhead").length,
    hourLabels: document.querySelectorAll(".hour-label").length,
    bcap: document.querySelectorAll(".band-label .bcap").length,
    summaryHasLabel: (document.getElementById("summaryBar")?.textContent || "").includes("chamados ativos"),
    nowLine: document.querySelectorAll(".now-line").length,
    title: document.getElementById("weekTitle")?.textContent,
  }));
  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-week.png" });
  await audit("week");

  // --- mês ---
  await page.click('#viewSwitch [data-view="month"]');
  await page.waitForSelector(".month");
  out.month = await page.evaluate(() => ({
    mdays: document.querySelectorAll(".mday").length,
    out: document.querySelectorAll(".mday.out").length,
    chips: document.querySelectorAll(".mc").length,
    title: document.getElementById("weekTitle")?.textContent,
  }));
  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-month.png" });
  await audit("month");

  // --- ano ---
  await page.click('#viewSwitch [data-view="year"]');
  await page.waitForSelector(".year");
  out.year = await page.evaluate(() => ({
    tiles: document.querySelectorAll(".mtile").length,
    heatCells: document.querySelectorAll(".heat .hc").length,
    title: document.getElementById("weekTitle")?.textContent,
  }));
  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-year.png" });
  await audit("year");

  // --- dia ---
  await page.click('#viewSwitch [data-view="day"]');
  await page.waitForSelector(".dayrow");
  out.day = await page.evaluate(() => ({
    days: document.querySelectorAll(".dayrow").length,
    hasTimeline: !!document.querySelector(".dayrow .day.tl"),
    title: document.getElementById("weekTitle")?.textContent,
  }));
  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-day.png" });
  await audit("day");

  // --- densidade: expandido aumenta o slot da régua do dia ---
  const slotBefore = await page.$eval(".dayrow .day.tl", (el) => parseFloat(getComputedStyle(el).getPropertyValue("--tl-slot")));
  await page.click("#densityWrap .cs-trigger");
  await page.waitForSelector('#densityMenu .cs-option[data-value="expanded"]');
  await page.click('#densityMenu .cs-option[data-value="expanded"]');
  await new Promise((r) => setTimeout(r, 200));
  const slotAfter = await page.$eval(".dayrow .day.tl", (el) => parseFloat(getComputedStyle(el).getPropertyValue("--tl-slot")));
  out.density = { densLabel: await page.$eval("#densityLabel", (el) => el.textContent), slotBefore, slotAfter, grew: slotAfter > slotBefore };

  // --- teclado: D -> semana, M -> mês, seta direita muda período ---
  await page.keyboard.press("KeyW");
  const afterW = await page.$$eval(".dhead", (els) => els.length);
  const title1 = await page.$eval("#weekTitle", (el) => el.textContent);
  await page.keyboard.press("ArrowRight");
  await sleep(120);
  const title2 = await page.$eval("#weekTitle", (el) => el.textContent);
  out.keyboard = { dheadsAfterW: afterW, weekChanged: title1 !== title2, title1, title2 };

  // --- Visual: cor por urgência ---
  await page.click("#settingsBtn");
  await page.waitForSelector("#settingsModal.open");
  await page.click('#colorBySeg [data-colorby="priority"]');
  await sleep(200);
  const catFieldHidden = await page.$eval("#catColorField", (el) => el.hidden);
  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-prefs.png" });
  await page.click('#settingsModal [data-close]');
  out.prefs = { catFieldHiddenWhenPriority: catFieldHidden };

  // --- modais cabem na tela ---
  const modalFit = async (openSel: string, backdropId: string) => {
    await page.click(openSel);
    await page.waitForSelector(`#${backdropId} .modal`);
    await sleep(150);
    const fit = await page.evaluate((id: string) => {
      const r = (document.querySelectorAll(`#${id} .modal`)[0] as HTMLElement).getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, croppedTop: r.top < -1, croppedBottom: r.bottom > window.innerHeight + 2 };
    }, backdropId);
    await page.click(`#${backdropId} [data-close]`);
    await sleep(100);
    return fit;
  };
  out.modalAnalysts = await modalFit("#manageAnalysts", "analystsModal");
  out.modalReport = await modalFit("#reportBtn", "reportModal");

  // --- minimizar sidebar ---
  await page.click("#sideToggle");
  await sleep(300);
  out.collapse = await page.evaluate(() => {
    const h = (document.getElementById("side") as HTMLElement).getBoundingClientRect();
    const main = (document.querySelector("main") as HTMLElement).getBoundingClientRect();
    const ic = document.querySelector("#side.min .side-nav .m-item .ic") as HTMLElement | null;
    const lbl = document.querySelector("#side.min .side-nav .m-item .it") as HTMLElement | null;
    return {
      w: Math.round(h.width), mainL: Math.round(main.left),
      iconVisible: !!ic && getComputedStyle(ic).display !== "none",
      labelsHidden: !lbl || getComputedStyle(lbl).display === "none",
    };
  });
  await page.click("#sideToggle");
  await sleep(300);

  out.errors = errors;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (errors.length) process.exit(3);
}

main().catch((e) => { console.error(e); process.exit(1); });