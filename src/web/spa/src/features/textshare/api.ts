import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

// Both frontends brand text-share URLs as the public tools.e9.cx directory
// site, not the SPA's own origin — see api.ts in src/web/tools-site for the
// matching constant/convention. The SPA still serves its own /t/:id viewer
// (TextViewPage) for completeness, but the *canonical* link handed to users
// is always the tools.e9.cx one.
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
}

export interface TextPastePublic {
  id: string;
  kind: "text";
  content: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface TextPastePage {
  items: TextPasteSummary[];
  nextCursor: string | null;
}

export function shareUrlFor(id: string): string {
  return `${TEXT_SHARE_HOST}/t/${id}`;
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
}

/** POST /tools/text — mint a text paste. `expiresInSeconds` must be between
 * 1 hour (3600) and 30 days (2592000); omit for the 7-day server default. */
export async function mintTextPaste(content: string, expiresInSeconds?: number): Promise<TextPasteMinted> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expiresInSeconds ? { content, expiresInSeconds } : { content }),
  });
  return parseJsonOrThrow<TextPasteMinted>(resp);
}

/** GET /tools/text — the caller's own pastes, newest first. */
export async function listTextPastes(cursor?: string | null): Promise<TextPastePage> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetchWithAuth(`${base}/tools/text${qs ? `?${qs}` : ""}`);
  return parseJsonOrThrow<TextPastePage>(resp);
}

/** DELETE /tools/text/{id} — creator only. */
export async function deleteTextPaste(id: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/text/${encodeURIComponent(id)}`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}

/** GET /tools/text/{id} — PUBLIC. Plain, unauthenticated `fetch` — this is
 * consumed by TextViewPage, which must render for a signed-out visitor. Do
 * NOT swap this for fetchWithAuth/fetchWithAuthOptional: the route has no
 * Cognito authorizer at all (see infra/tools.tf toolsTextGetPublic), and a
 * bearer token here would just be a wasted/misleading header. */
export async function getPublicTextPaste(id: string): Promise<TextPastePublic> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetch(`${base}/tools/text/${encodeURIComponent(id)}`);
  return parseJsonOrThrow<TextPastePublic>(resp);
}
