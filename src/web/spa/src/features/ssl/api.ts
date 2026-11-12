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

export interface SslCert {
  subject: string;
  issuer: string;
  sans: { dns: string[]; ip: string[] };
  serial: string;
  signatureHash: string | null;
  keyType: string;
  keySize: number | null;
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
}

export interface SslResult {
  host: string;
  port: number;
  ip: string;
  status: "ok" | "warning" | "error";
  trusted: boolean;
  trustError: string | null;
  hostnameMatch: boolean;
  tlsVersion: string;
  cipher: string;
  daysLeft: number;
  /** Leaf first. */
  chain: SslCert[];
}

export const SSL_PORTS = [443, 465, 636, 853, 990, 993, 995, 5061, 8443];

/** GET /tools/ssl?host=&port= — TLS certificate report (see tools/sslcheck.py). */
export async function sslCheck(host: string, port: number): Promise<SslResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ host, port: String(port) });
  const resp = await fetchWithAuth(`${base}/tools/ssl?${params.toString()}`);
  return parseJsonOrThrow<SslResult>(resp);
}
