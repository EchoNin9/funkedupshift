import { fetchWithAuth } from "../../utils/api";

export type FeedKind = "rss" | "atom" | "json" | "push";

export interface Feed {
  feedId: string;
  title: string;
  kind: FeedKind;
  pinned: boolean;
  sortOrder: number;
  tz: string;
  createdAt: string;
  todayCount: number;
  failCount: number;
  slug?: string;
  url?: string;
  siteUrl?: string;
  lastFetchedAt?: string;
  lastItemAt?: string;
  lastError?: string;
}

export interface DaySummary {
  day: string;
  count: number;
}

export interface DaysPage {
  days: DaySummary[];
  nextCursor: string | null;
}

export interface FeedItem {
  itemSk: string;
  itemHash: string;
  day: string;
  title: string;
  summary: string;
  contentHtml: string;
  publishedAt: string;
  fetchedAt: string;
  starred: boolean;
  seen: boolean;
  link?: string;
  author?: string;
  guid?: string;
}

export interface DayItemsResponse {
  feed: Feed;
  day: string;
  items: FeedItem[];
}

export interface StarItem {
  starSk: string;
  starredAt: string;
  feedId: string;
  itemSk: string;
  itemHash: string;
  day: string;
  title: string;
  snippet: string;
  feedTitle: string;
  feedKind: FeedKind;
  link?: string;
}

export interface StarsPage {
  items: StarItem[];
  nextCursor: string | null;
}

export interface SeenItem {
  seenSk: string;
  seenAt: string;
  feedId: string;
  itemSk: string;
  itemHash: string;
  day: string;
  title: string;
  snippet: string;
  feedTitle: string;
  feedKind: FeedKind;
  link?: string;
}

export interface SeenPage {
  items: SeenItem[];
  nextCursor: string | null;
}

export interface ApiKeyMeta {
  keyId: string;
  name: string;
  prefix: string;
  createdAt: string;
  revoked: boolean;
  lastUsedAt?: string;
}

export interface CreateKeyResponse {
  key: ApiKeyMeta;
  rawKey: string;
}

export interface UserPrefs {
  tz: string;
}

export class AuthExpiredError extends Error {
  constructor(message: string = "Session expired — please sign in again.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export class ApiError extends Error {
  status: number;
  data?: Record<string, unknown>;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL;
  if (!raw || raw === "API_URL_PLACEHOLDER") return null;
  return raw.replace(/\/$/, "");
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API is not configured for this environment.");

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (options?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let resp: Response;
  try {
    resp = await fetchWithAuth(`${base}${path}`, { ...options, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Not signed in" || msg.startsWith("Session expired")) {
      throw new AuthExpiredError(
        msg === "Not signed in" ? "Not signed in." : "Session expired — please sign in again."
      );
    }
    throw err;
  }

  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

  if (resp.status === 401) {
    throw new AuthExpiredError("Session expired — please sign in again.");
  }
  if (!resp.ok) {
    const msg = typeof data.error === "string" ? data.error : `Request failed (${resp.status})`;
    throw new ApiError(msg, resp.status, data);
  }
  return data as T;
}

export function listFeeds(): Promise<{ feeds: Feed[]; tz: string }> {
  return fetchJson<{ feeds: Feed[]; tz: string }>("/feeds");
}

export function createPolledFeed(
  url: string,
  title?: string
): Promise<{ feed: Feed; itemsAdded: number }> {
  const body: Record<string, unknown> = { kind: "poll", url };
  if (title && title.trim()) body.title = title.trim();
  return fetchJson<{ feed: Feed; itemsAdded: number }>("/feeds", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createPushFeed(
  title: string,
  slug?: string
): Promise<{ feed: Feed; itemsAdded: number }> {
  const body: Record<string, unknown> = { kind: "push", title };
  if (slug && slug.trim()) body.slug = slug.trim();
  return fetchJson<{ feed: Feed; itemsAdded: number }>("/feeds", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reorderFeeds(feedIds: string[]): Promise<{ feedIds: string[] }> {
  return fetchJson<{ feedIds: string[] }>("/feeds/order", {
    method: "PUT",
    body: JSON.stringify({ feedIds }),
  });
}

export function updateFeed(
  feedId: string,
  patch: { title?: string; pinned?: boolean; sortOrder?: number }
): Promise<{ feed: Feed }> {
  return fetchJson<{ feed: Feed }>(`/feeds/${encodeURIComponent(feedId)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteFeed(feedId: string): Promise<{ deleted: boolean; feedId: string }> {
  return fetchJson<{ deleted: boolean; feedId: string }>(`/feeds/${encodeURIComponent(feedId)}`, {
    method: "DELETE",
  });
}

export function refreshFeed(
  feedId: string
): Promise<{ feed: Feed; notModified: boolean; itemsAdded: number }> {
  return fetchJson<{ feed: Feed; notModified: boolean; itemsAdded: number }>(
    `/feeds/${encodeURIComponent(feedId)}/refresh`,
    { method: "POST" }
  );
}

export function listDays(
  feedId: string,
  cursor?: string | null,
  limit: number = 60
): Promise<DaysPage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("cursor", cursor);
  return fetchJson<DaysPage>(`/feeds/${encodeURIComponent(feedId)}/days?${qs.toString()}`);
}

export function getDayItems(feedId: string, day: string): Promise<DayItemsResponse> {
  return fetchJson<DayItemsResponse>(
    `/feeds/${encodeURIComponent(feedId)}/days/${encodeURIComponent(day)}`
  );
}

export function listStars(cursor?: string | null, limit: number = 50): Promise<StarsPage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("cursor", cursor);
  return fetchJson<StarsPage>(`/feeds/stars?${qs.toString()}`);
}

export function starItem(
  feedId: string,
  itemSk: string
): Promise<{ starred: boolean; star: StarItem }> {
  return fetchJson<{ starred: boolean; star: StarItem }>("/feeds/stars", {
    method: "PUT",
    body: JSON.stringify({ feedId, itemSk }),
  });
}

export function unstarItem(feedId: string, itemSk: string): Promise<{ starred: boolean }> {
  const qs = new URLSearchParams({ feedId, itemSk });
  return fetchJson<{ starred: boolean }>(`/feeds/stars?${qs.toString()}`, {
    method: "DELETE",
  });
}

export function listSeen(cursor?: string | null, limit: number = 50): Promise<SeenPage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("cursor", cursor);
  return fetchJson<SeenPage>(`/feeds/seen?${qs.toString()}`);
}

export function markSeen(
  feedId: string,
  itemSk: string
): Promise<{ seen: boolean; seenItem: SeenItem }> {
  return fetchJson<{ seen: boolean; seenItem: SeenItem }>("/feeds/seen", {
    method: "PUT",
    body: JSON.stringify({ feedId, itemSk }),
  });
}

export function unmarkSeen(feedId: string, itemSk: string): Promise<{ seen: boolean }> {
  const qs = new URLSearchParams({ feedId, itemSk });
  return fetchJson<{ seen: boolean }>(`/feeds/seen?${qs.toString()}`, {
    method: "DELETE",
  });
}

export function listKeys(): Promise<{ keys: ApiKeyMeta[] }> {
  return fetchJson<{ keys: ApiKeyMeta[] }>("/feeds/keys");
}

export function createKey(name: string): Promise<CreateKeyResponse> {
  return fetchJson<CreateKeyResponse>("/feeds/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeKey(keyId: string): Promise<{ revoked: boolean; keyId: string }> {
  return fetchJson<{ revoked: boolean; keyId: string }>(
    `/feeds/keys/${encodeURIComponent(keyId)}`,
    { method: "DELETE" }
  );
}

export function getPrefs(): Promise<UserPrefs> {
  return fetchJson<UserPrefs>("/feeds/prefs");
}

export function updatePrefs(tz: string): Promise<UserPrefs> {
  return fetchJson<UserPrefs>("/feeds/prefs", {
    method: "PUT",
    body: JSON.stringify({ tz }),
  });
}
