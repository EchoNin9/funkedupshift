import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export interface ShortLink {
  code: string;
  url: string;
  shortUrl: string;
  /** ISO 8601 string. */
  createdAt: string;
  /** Epoch seconds. */
  expiresAt: number;
  /** Presigned GET (~1h) for the saved QR image; absent when none is saved. */
  qrUrl?: string;
  /** ISO 8601 string; present iff qrUrl is. */
  qrUpdatedAt?: string;
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
    body: JSON.stringify({ url }),
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
    body: JSON.stringify({ expiresAt }),
  });
  return parseJsonOrThrow<ShortLink>(resp);
}

/** Save (or replace) the QR image for a short link: POST /s/{code}/qr returns
 * a presigned S3 POST (5 MB cap enforced by its policy), the browser uploads
 * straight to S3 (no auth header — the policy is the credential), then
 * PUT /s/{code}/qr confirms and records it. */
export async function saveQr(code: string, png: Blob): Promise<{ qrUrl?: string; qrUpdatedAt?: string }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const path = `${base}/s/${encodeURIComponent(code)}/qr`;
  const presign = await parseJsonOrThrow<{ uploadUrl: string; fields: Record<string, string> }>(
    await fetchWithAuth(path, { method: "POST" })
  );
  const form = new FormData();
  Object.entries(presign.fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", png); // must be the last field for S3
  const up = await fetch(presign.uploadUrl, { method: "POST", body: form });
  if (!up.ok) throw new Error(up.status === 400 ? "QR image rejected (too large?)" : `Upload failed (${up.status})`);
  return parseJsonOrThrow<{ qrUrl?: string; qrUpdatedAt?: string }>(await fetchWithAuth(path, { method: "PUT" }));
}

/** DELETE /s/{code}/qr — remove the saved QR image. */
export async function deleteQr(code: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s/${encodeURIComponent(code)}/qr`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}
