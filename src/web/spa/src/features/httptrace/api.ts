import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
}

export interface HttpHop {
  url: string;
  /** Absent when the hop failed before a request was made. */
  method?: "HEAD" | "GET";
  status?: number;
  reason?: string;
  httpVersion?: string;
  location?: string | null;
  nextUrl?: string | null;
  timeMs?: number;
  ip?: string | null;
  /** [name, value] pairs in received order (repeats kept). */
  headers?: [string, string][];
  truncated?: boolean;
  error?: string;
}

export interface HttpSecurityEntry {
  name: string;
  present: boolean;
  value: string | null;
  ok: boolean;
  note: string;
}

export interface HttpTraceResult {
  input: string;
  hops: HttpHop[];
  stopReason: "final response" | "redirect loop" | "too many redirects" | "error" | "timed out";
  finalUrl: string | null;
  finalStatus: number | null;
  totalMs: number;
  /** security, securityGrade, cache and cdn are omitted when no hop got a response. */
  security?: HttpSecurityEntry[];
  securityGrade?: "A" | "B" | "C" | "D" | "F";
  cache?: Record<string, string>;
  cdn?: { detected: string[]; server: string | null; poweredBy: string | null };
}

/** GET /tools/http?url= — redirect chain and header report (see tools/httptrace.py). */
export async function httpTrace(url: string): Promise<HttpTraceResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/http?${new URLSearchParams({ url }).toString()}`);
  return parseJsonOrThrow<HttpTraceResult>(resp);
}
