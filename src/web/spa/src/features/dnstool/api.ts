import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SOA" | "SRV" | "CAA" | "PTR";

export const DNS_RECORD_TYPES: DnsRecordType[] = [
  "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA", "PTR",
];

export type DnsStatus = "ok" | "nxdomain" | "noanswer" | "timeout";

export interface DnsRecord {
  record: string;
  ttl: number;
  value: string;
}

export interface DnsResult {
  name: string;
  type: DnsRecordType;
  records: DnsRecord[];
  status: DnsStatus;
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
}

/** GET /tools/dns?name=&type= — a single typed DNS query. "All types" fan-out
 * (one request per type) is a client-side concern; see DnsPage.tsx. */
export async function dnsLookup(name: string, type: DnsRecordType): Promise<DnsResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ name, type });
  const resp = await fetchWithAuth(`${base}/tools/dns?${params.toString()}`);
  return parseJsonOrThrow<DnsResult>(resp);
}
