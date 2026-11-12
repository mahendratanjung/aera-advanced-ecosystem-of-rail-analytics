import { useSession } from "./session";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export function wsUrl(token: string | null): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/api/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * The backend runs on a free plan that sleeps when idle and takes up to about a minute to wake.
 * Reads are retried through that (the page keeps its loading state) instead of showing
 * "unavailable" at once; writes are never repeated.
 */
const WAKE_MS = 90_000;
const BUSY = new Set([502, 503, 504]);

async function fetchWaking(url: string, init: RequestInit): Promise<Response> {
  const read = !init.method || init.method.toUpperCase() === "GET";
  const start = Date.now();
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (!read || !BUSY.has(res.status) || Date.now() - start > WAKE_MS) return res;
    } catch (e) {
      if (!read || Date.now() - start > WAKE_MS) throw e;
    }
    await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** i)));
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = useSession.getState().token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetchWaking(`${API_URL}/api${path}`, { ...init, headers, body });
  if (res.status === 401 && token) useSession.getState().signOut();
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
