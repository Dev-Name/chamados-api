import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { CycleDependencyError, AnalystNotFoundError } from "./lib/errors";
import { recalculateAllQueues } from "./services/ticket.service";
import { analystsRouter } from "./routes/analysts";
import { ticketsRouter } from "./routes/tickets";
import { categoriesRouter } from "./routes/categories";

const app = express();
app.use(express.json({ limit: "6mb" }));

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