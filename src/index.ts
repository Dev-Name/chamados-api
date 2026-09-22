import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CycleDependencyError, AnalystNotFoundError } from "./lib/errors";
import { recalculateAllQueues } from "./services/ticket.service";
import { analystsRouter } from "./routes/analysts";
import { ticketsRouter } from "./routes/tickets";
import { categoriesRouter } from "./routes/categories";

const app = express();

// Headers de segurança básicos (sem dependência externa)
function csp(nonce?: string): string {
  const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return [
    `default-src 'self' blob:`,
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", csp());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use(express.json({ limit: "6mb" }));

// Página principal: injeta um nonce no script inline do bundle e libera via CSP
// (o build-ui embute o JS dentro do HTML, então 'self' sozinho bloquearia).
app.get("/", async (_req, res, next) => {
  try {
    const html = await readFile(path.join(__dirname, "..", "public", "index.html"), "utf8");
    const nonce = randomBytes(16).toString("base64");
    res.setHeader("Content-Security-Policy", csp(nonce));
    res.type("html").send(html.replace("<script>", `<script nonce="${nonce}">`));
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/analysts", analystsRouter);
app.use("/tickets", ticketsRouter);
app.use("/categories", categoriesRouter);

// Recálculo de todas as filas
app.post("/recalculate", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await recalculateAllQueues();
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof CycleDependencyError) {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof AnalystNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Erro interno" });
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`chamados-api rodando em http://localhost:${port}`);
});