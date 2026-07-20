// Shortener API client. Deliberately NOT imported from src/web/spa — this app
// is a standalone deploy, so it carries its own thin copy of the request/
// response shapes and fetch wrapper (see src/web/spa/src/features/tools/api.ts
// and src/web/spa/src/utils/api.ts for the source of truth this mirrors).
// Difference from the SPA's fetchWithAuth: no impersonation headers — not
// relevant to this app.

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

/** Fetch with the signed-in user's bearer token. Throws "Not signed in" /
 * "Session expired — please sign in again" instead of ever firing an
 * unauthenticated request — callers (and the UI gating) rely on this. */
async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const w = window as any;
  if (!w.auth?.getAccessToken) throw new Error("Not signed in");
  const token: string | null = await new Promise((resolve) => w.auth.getAccessToken(resolve));
  if (!token) throw new Error("Session expired — please sign in again");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    Authorization: `Bearer ${token}`
  };
  return fetch(url, { ...options, headers });
}

export interface ShortLink {
  code: string;
  url: string;
  shortUrl: string;
  /** ISO 8601 string. */
  createdAt: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface ShortLinkPage {
  items: ShortLink[];
  nextCursor: string | null;
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
}

// ponytail: the backend mints fus.fyi shortUrls (SHORT_DOMAIN env var on the
// tools Lambda); this site brands them as e9.cx. Both hosts resolve on the
// same distribution/KVS, so a host swap is purely cosmetic.
const BRAND_HOST = "https://e9.cx";

function brand(link: ShortLink): ShortLink {
  return { ...link, shortUrl: link.shortUrl.replace(/^https?:\/\/[^/]+/, BRAND_HOST) };
}

/** POST /s — mint a short link for `url`. Throws with the API's error message on failure. */
export async function mintShortLink(url: string): Promise<ShortLink> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  return brand(await parseJsonOrThrow<ShortLink>(resp));
}

/** GET /s — the caller's own links, newest first. Pass `cursor` (from a prior
 * response's `nextCursor`) to fetch the next page. */
export async function listLinks(cursor?: string | null): Promise<ShortLinkPage> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetchWithAuth(`${base}/s${qs ? `?${qs}` : ""}`);
  const page = await parseJsonOrThrow<ShortLinkPage>(resp);
  return { ...page, items: page.items.map(brand) };
}

/** DELETE /s/{code} — only the creator may delete. */
export async function deleteLink(code: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s/${encodeURIComponent(code)}`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}

/** PATCH /s/{code} — set a new expiry (epoch seconds, must be in the future). */
export async function updateExpiry(code: string, expiresAt: number): Promise<ShortLink> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s/${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresAt })
  });
  return brand(await parseJsonOrThrow<ShortLink>(resp));
}

/** True for the "not signed in" / "session expired" errors thrown above —
 * callers use this to flip the UI back to the unauthed/auth view rather
 * than showing a generic error banner. */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Not signed in" || msg.startsWith("Session expired");
}

// --- DNS lookup tool -------------------------------------------------------

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SOA" | "SRV" | "CAA" | "PTR";

export const DNS_RECORD_TYPES: DnsRecordType[] = [
  "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA", "PTR"
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

/** GET /tools/dns?name=&type= — a single typed DNS query. "All types" fan-out
 * (one request per type) is a client-side concern; see DnsTool.tsx. */
export async function dnsLookup(name: string, type: DnsRecordType): Promise<DnsResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ name, type });
  const resp = await fetchWithAuth(`${base}/tools/dns?${params.toString()}`);
  return parseJsonOrThrow<DnsResult>(resp);
}

// --- text-paste sharing (FUNK-40) -------------------------------------------

// The public-facing host for share links. Both frontends brand text-share
// URLs this way (tools.e9.cx is the public directory site), even though this
// app itself is served there — mirrors BRAND_HOST above for short links.
export const TEXT_SHARE_HOST = "https://tools.e9.cx";

export interface TextPasteSummary {
  id: string;
  kind: "text";
  /** ISO 8601 string. */
  createdAt: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface TextPasteMinted {
  id: string;
  kind: "text";
  createdAt: string;
  expiresAt: number;
  shareUrl: string;
}

export interface TextPastePublic {
  id: string;
  kind: "text";
  content: string;
  /** Epoch seconds. */
  expiresAt: number;
}

function shareUrlFor(id: string): string {
  return `${TEXT_SHARE_HOST}/t/${id}`;
}

/** POST /tools/text — mint a text paste. `expiresInSeconds` must be between
 * 1 hour (3600) and 30 days (2592000); omit for the 7-day server default. */
export async function mintTextPaste(content: string, expiresInSeconds?: number): Promise<TextPasteMinted> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expiresInSeconds ? { content, expiresInSeconds } : { content })
  });
  const paste = await parseJsonOrThrow<Omit<TextPasteMinted, "shareUrl">>(resp);
  return { ...paste, shareUrl: shareUrlFor(paste.id) };
}

/** GET /tools/text — the caller's own pastes, newest first. */
export async function listTextPastes(cursor?: string | null): Promise<{ items: TextPasteSummary[]; nextCursor: string | null }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetchWithAuth(`${base}/tools/text${qs ? `?${qs}` : ""}`);
  return parseJsonOrThrow(resp);
}

/** DELETE /tools/text/{id} — creator only. */
export async function deleteTextPaste(id: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/text/${encodeURIComponent(id)}`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}

/** GET /tools/text/{id} — PUBLIC. Plain fetch, no auth token — this must
 * work for a signed-out visitor who just opened a shared link. A 404
 * (unknown or expired paste) throws "Not found". */
export async function getPublicTextPaste(id: string): Promise<TextPastePublic> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetch(`${base}/tools/text/${encodeURIComponent(id)}`);
  return parseJsonOrThrow<TextPastePublic>(resp);
}
