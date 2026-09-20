import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export class CycleDependencyError extends Error {
  constructor(ids: number[]) {
    super(`Dependência cíclica detectada entre os chamados: ${ids.join(" -> ")}`);
    this.name = "CycleDependencyError";
  }
}

export class AnalystNotFoundError extends Error {
  constructor(analystId: number) {
    super(`Analista ${analystId} não encontrado`);
    this.name = "AnalystNotFoundError";
  }
}