import type { Analyst, Category, Ticket } from "./state";
import { store } from "./state";

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = "Erro " + res.status;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (null as T) : (res.json() as Promise<T>);
}

export async function loadCategories(): Promise<void> {
  store.categories = await api<Category[]>("/categories");
}

export interface ReloadOpts {
  refToToday?: boolean;
}

export type ReloadHook = (opts?: ReloadOpts) => Promise<void>;

let reloadHook: ReloadHook | null = null;

export function setReloadHook(fn: ReloadHook): void {
  reloadHook = fn;
}

export async function reloadAfterMutation(opts?: ReloadOpts): Promise<void> {
  if (reloadHook) await reloadHook(opts);
}

export async function loadAnalysts(): Promise<void> {
  const list = await api<Analyst[]>("/analysts");
  const withQueue = await Promise.all(
    list.map(async (a) => {
      const q = await api<{ tickets: Ticket[] }>("/analysts/" + a.id + "/queue");
      return { ...a, tickets: q.tickets };
    })
  );
  store.analysts = withQueue;
}