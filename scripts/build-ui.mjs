import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("public/assets", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["frontend/src/main.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    outfile: "public/assets/app.js",
    sourcemap: true,
    minify: true,
    logLevel: "info",
  }),
  cp("frontend/index.html", "public/index.html"),
]);

// injeta JS + CSS no HTML final para que a página seja autossuficiente
// (os testes de JSDOM leem o arquivo e executam apenas scripts inline).
const html = await readFile("public/index.html", "utf8");
const js = await readFile("public/assets/app.js", "utf8");
const css = await readFile("public/assets/app.css", "utf8");

const inlined = html
  .replace('<link rel="stylesheet" href="/assets/app.css">', `<style>${css}</style>`)
  .replace('<script src="/assets/app.js"></script>', `<script>${js}</script>`);

await writeFile("public/index.html", inlined, "utf8");

console.log("UI build: public/index.html (JS+CSS inline) + public/assets/app.{js,css}");