import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export type EmailAuthSeverity = "high" | "medium" | "low";

export interface EmailAuthFix {
  severity: EmailAuthSeverity;
  message: string;
}

export interface SpfNode {
  domain: string;
  via: "include" | "redirect" | null;
  record: string | null;
  error: string | null;
  children: SpfNode[];
}

export interface EmailAuthResult {
  domain: string;
  grade: "A" | "B" | "C" | "D" | "F";
  fixes: EmailAuthFix[];
  spf: {
    present: boolean;
    record: string | null;
    recordCount: number;
    mechanisms: { qualifier: string; mechanism: string; value: string }[];
    modifiers: { name: string; value: string }[];
    all: string | null;
    lookupCount: number;
    tree: SpfNode | null;
    errors: string[];
    notes: string[];
  };
  dmarc: { present: boolean; record: string | null; tags: Record<string, string>; error: string | null };
  dkim: {
    selector: string;
    found: boolean;
    keyType: string | null;
    keyBits: number | null;
    warnings: string[];
  }[];
  mx: { preference: number; host: string }[];
  mtaSts: { present: boolean; record: string | null };
  tlsRpt: { present: boolean; record: string | null };
  bimi: { present: boolean; record: string | null };
  warnings: string[];
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
}

/** GET /tools/emailauth?domain=&selectors= — SPF/DKIM/DMARC/MX report (see tools/emailauth.py). */
export async function emailAuthCheck(domain: string, selectors: string): Promise<EmailAuthResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ domain });
  if (selectors) params.set("selectors", selectors);
  const resp = await fetchWithAuth(`${base}/tools/emailauth?${params.toString()}`);
  return parseJsonOrThrow<EmailAuthResult>(resp);
}
