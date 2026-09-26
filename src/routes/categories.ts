import { Router } from "express";
import { prisma } from "../lib/errors";
import { parseId } from "../lib/http";

export const categoriesRouter = Router();

const MAX_NAME = 120;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function validateHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim();
  return HEX_RE.test(hex) ? hex.toLowerCase() : null;
}

function nameOf(body: unknown): string | null | undefined {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.name !== "string") return undefined;
  return b.name.trim();
}

function ativoOf(body: unknown): boolean {
  const b = body as Record<string, unknown> | null;
  return b?.ativo !== false;
}

/** Trata violação de unicidade de nome de forma amigável. */
function uniqueError(err: unknown, name: string): { status: number; json: { error: string } } | null {
  if ((err as { code?: string }).code === "P2002") {
    return { status: 409, json: { error: `Já existe uma categoria chamada "${name}"` } };
  }
  return null;
}

categoriesRouter.get("/", async (_req, res, next) => {
  try {
    // Traz o total de chamados (_count) para a listagem exibir o uso de cada categoria
    const categories = await prisma.category.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { _count: { select: { tickets: true } } },
    });
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

categoriesRouter.post("/", async (req, res, next) => {
  try {
    const name = nameOf(req.body);
    if (!name) {
      res.status(400).json({ error: "name é obrigatório" });
      return;
    }
    if (name.length > MAX_NAME) {
      res.status(400).json({ error: `name deve ter no máximo ${MAX_NAME} caracteres` });
      return;
    }
    const cor = validateHex(req.body?.cor);
    if (!cor) {
      res.status(400).json({ error: "cor é obrigatória (hex, ex.: #3b82f6)" });
      return;
    }
    const category = await prisma.category.create({ data: { name, cor, ativo: ativoOf(req.body) } });
    res.status(201).json(category);
  } catch (error) {
    const uniq = uniqueError(error, typeof req.body?.name === "string" ? req.body.name.trim() : "?");
    if (uniq) { res.status(uniq.status).json(uniq.json); return; }
    next(error);
  }
});

categoriesRouter.patch("/:id", async (req, res, next) => {
  try {
    const categoryId = parseId(req.params.id);
    if (!categoryId) { res.status(400).json({ error: "ID inválido" }); return; }
    const existing = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada" });
      return;
    }

    const data: { name?: string; cor?: string; ativo?: boolean } = {};
    if (req.body && "name" in req.body) {
      const name = nameOf(req.body);
      if (!name) {
        res.status(400).json({ error: "name não pode ser vazio" });
        return;
      }
      if (name.length > MAX_NAME) {
        res.status(400).json({ error: `name deve ter no máximo ${MAX_NAME} caracteres` });
        return;
      }
      data.name = name;
    }
    if (req.body && "cor" in req.body) {
      const cor = validateHex(req.body.cor);
      if (!cor) {
        res.status(400).json({ error: "cor inválida (hex, ex.: #3b82f6)" });
        return;
      }
      data.cor = cor;
    }
    if (req.body && "ativo" in req.body) {
      data.ativo = req.body.ativo !== false;
    }

    const category = await prisma.category.update({ where: { id: categoryId }, data });
    res.json(category);
  } catch (error) {
    const b = req.body as Record<string, unknown> | null;
    const uniq = uniqueError(error, b && typeof b.name === "string" ? b.name.trim() : "?");
    if (uniq) { res.status(uniq.status).json(uniq.json); return; }
    next(error);
  }
});

categoriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const categoryId = parseId(req.params.id);
    if (!categoryId) { res.status(400).json({ error: "ID inválido" }); return; }
    const existing = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada" });
      return;
    }
    const inUse = await prisma.ticket.count({ where: { categoryId } });
    if (inUse > 0) {
      res.status(409).json({
        error: `Não é possível excluir: há ${inUse} chamado${inUse === 1 ? "" : "s"} vinculado${inUse === 1 ? "" : "s"}. Inative a categoria em vez de excluir.`,
      });
      return;
    }
    await prisma.category.delete({ where: { id: categoryId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});