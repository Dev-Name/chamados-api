import type { Analyst, Category } from "./state";
import { store } from "./state";

function setConn(ok: boolean): void {
  document.body.dataset.conn = ok ? "on" : "off";
  const lbl = document.querySelector(".live-lbl");
  if (lbl) lbl.textContent = ok ? "Ao Vivo" : "Offline";
}

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    setConn(false);
    throw err;
  }
  setConn(true);
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
  // Usa /analysts/with-queues para carregar analistas e filas numa única query (evita N+1)
  store.analysts = await api<Analyst[]>("/analysts/with-queues");
}