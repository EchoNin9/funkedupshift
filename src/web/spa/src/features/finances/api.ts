import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export interface Account {
  id: string;
  name: string;
  kind: string;
  balance: number;
  currency: string;
  source: "local" | "era";
  updatedAt?: string;
}

export interface Txn {
  id: string;
  date: string;
  accountId: string;
  amount: number;
  payee: string;
  category: string;
  notes: string;
  source: "local" | "era";
}

export interface Budget {
  category: string;
  monthlyLimit: number;
  actual?: number;
}

export interface Overview {
  accounts: Account[];
  netWorth: number;
  cashFlow30d: { income: number; spend: number; net: number };
  cashFlowSeries90d: { date: string; net: number }[];
  eraConnected: boolean;
}

export interface Insights {
  period: string;
  spendingByCategory: Record<string, number>;
  comparison: {
    period: string;
    previousPeriod: string;
    spend: number;
    previousSpend: number;
    income: number;
    previousIncome: number;
  };
  forecast: { month: string; projectedNet: number }[];
  eraConnected: boolean;
  era?: unknown;
}

export interface Share {
  granteeId: string;
  granteeEmail: string;
  sections: string[];
}

export interface SharedWithMe {
  ownerId: string;
  ownerEmail: string;
  sections: string[];
}

/** GET helper: throws Error with the API's message on non-2xx. */
export async function apiGet<T>(path: string): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}${path}`);
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${resp.status})`);
  }
  return resp.json() as Promise<T>;
}

/** Mutating helper (POST/PUT/DELETE JSON). */
export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${resp.status})`);
  }
  return resp.json() as Promise<T>;
}

/** `&owner=` suffix (or empty) for read endpoints in shared mode. */
export function ownerParam(owner: string | null): string {
  return owner ? `&owner=${encodeURIComponent(owner)}` : "";
}

export function fmtMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
