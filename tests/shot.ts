import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));

  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-full.png", fullPage: true });
  await page.screenshot({ path: "C:\\Users\\Jhonatan\\AppData\\Local\\Temp\\opencode\\cal-viewport.png" });

  const info = await page.evaluate(() => {
    const bands = [...document.querySelectorAll(".band")];
    const firstCell = bands[0]?.querySelector(".day");
    return {
      numBands: bands.length,
      bandHeight: bands[0]?.getBoundingClientRect().height,
      dayCellHeight: firstCell ? firstCell.getBoundingClientRect().height : null,
      blocks: document.querySelectorAll(".blk").length,
      hourLinesInFirstDay: firstCell ? firstCell.querySelectorAll(".hour-line").length : null,
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      windowWidth: window.innerWidth,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});