import { Router } from "express";
import { prisma } from "../lib/errors";

export const categoriesRouter = Router();

categoriesRouter.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { id: "asc" }, include: { _count: true } });
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

categoriesRouter.post("/", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name é obrigatório" });
      return;
    }
    const category = await prisma.category.create({ data: { name } });
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

categoriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const categoryId = Number(req.params.id);
    const existing = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!existing) {
      res.status(404).json({ error: "Categoria não encontrada" });
      return;
    }
    const inUse = await prisma.ticket.count({ where: { categoryId } });
    if (inUse > 0) {
      res.status(409).json({ error: "Não é possível excluir uma categoria com chamados vinculados" });
      return;
    }
    await prisma.category.delete({ where: { id: categoryId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});