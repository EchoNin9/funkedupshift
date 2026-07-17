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
  const data = (await resp.json().catch(() => ({}))) as ShortLink & { error?: string };
  if (!resp.ok) {
    throw new Error(data.error ?? `Request failed (${resp.status})`);
  }
  return data;
}
