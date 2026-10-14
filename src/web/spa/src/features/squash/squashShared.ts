export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export interface Player {
  id: string;
  PK?: string;
  name?: string;
}

export interface Match {
  id?: string;
  date?: string;
  teamAPlayer1Id?: string;
  teamAPlayer2Id?: string;
  teamBPlayer1Id?: string;
  teamBPlayer2Id?: string;
  winningTeam?: string;
  teamAGames?: number;
  teamBGames?: number;
  tags?: string[];
}

export interface SearchFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  playerIds?: string[];
  playerMode?: "and" | "or";
  sortOrder?: "newest" | "oldest";
  tags?: string[];
  tagMode?: "and" | "or";
}

/** Canonical filter shape: defaults (newest, no tags) are omitted, matching what the server stores. */
export const buildFilters = (
  date: string,
  dateFrom: string,
  dateTo: string,
  playerIds: string[],
  playerMode: "and" | "or",
  sortOrder: "newest" | "oldest" = "newest",
  tags: string[] = [],
  tagMode: "and" | "or" = "and"
): SearchFilters => ({
  ...(date ? { date } : {}),
  ...(dateFrom ? { dateFrom } : {}),
  ...(dateTo ? { dateTo } : {}),
  ...(playerIds.length ? { playerIds, playerMode } : {}),
  ...(tags.length ? { tags, tagMode } : {}),
  ...(sortOrder === "oldest" ? { sortOrder } : {})
});

export interface Share {
  id: string;
  title?: string;
  mode?: "snapshot" | "live";
  expiresAt?: number;
  filters?: SearchFilters;
}

export const SHARE_LIMIT = 10;

export async function apiError(resp: Response, fallback = "Failed"): Promise<string> {
  const d = await resp.json().catch(() => ({}));
  return (d as { error?: string }).error || fallback;
}

export const shareUrl = (id: string) => `${window.location.origin}/squash/s/${id}`;

export const inputCls =
  "block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export const primaryBtn =
  "rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-400 disabled:opacity-50";
export const secondaryBtn =
  "rounded-md border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-3 transition-colors";
export const smallBtn =
  "rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 transition-colors";
export const dangerBtn = "rounded-md border border-danger/20 px-2 py-1 text-xs text-danger hover:bg-danger/20";
