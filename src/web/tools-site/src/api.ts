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

/** POST /s — mint a short link for `url`. Throws with the API's error message on failure. */
export async function mintShortLink(url: string): Promise<ShortLink> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  return parseJsonOrThrow<ShortLink>(resp);
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
  return parseJsonOrThrow<ShortLinkPage>(resp);
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
  return parseJsonOrThrow<ShortLink>(resp);
}

/** True for the "not signed in" / "session expired" errors thrown above —
 * callers use this to flip the UI back to the unauthed/auth view rather
 * than showing a generic error banner. */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Not signed in" || msg.startsWith("Session expired");
}
