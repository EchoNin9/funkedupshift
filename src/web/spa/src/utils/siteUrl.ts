import { fetchWithAuth } from "./api";

/** Mirrors backend api/site_urls.py normalize_site_url (comparison only). */
export function normalizeSiteUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.port && u.port !== "80" && u.port !== "443") host += `:${u.port}`;
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return s.toLowerCase();
  }
}

export interface DuplicateSite {
  existingId: string;
  existingTitle?: string;
}

/** Early warning via existing GET /sites?q=<host>; backend 409 stays authoritative. */
export async function findDuplicateSite(apiBase: string, url: string): Promise<DuplicateSite | null> {
  const target = normalizeSiteUrl(url);
  if (!target) return null;
  const host = target.split(/[/?]/)[0];
  const resp = await fetchWithAuth(`${apiBase}/sites?q=${encodeURIComponent(host)}`);
  if (!resp.ok) return null;
  const data = (await resp.json()) as { sites?: { PK?: string; url?: string; title?: string }[] };
  const hit = (data.sites ?? []).find((s) => s.PK && normalizeSiteUrl(s.url ?? "") === target);
  return hit ? { existingId: hit.PK as string, existingTitle: hit.title } : null;
}
