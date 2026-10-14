import { useCallback, useEffect, useState } from "react";
import { resolveAppFrame } from "../components/AppPage";

/** localStorage key for the recently visited app routes. */
export const RECENT_KEY = "funkedupshift_recent";
const MAX_RECENT = 6;

export interface RecentRoute {
  /** Pathname of the visited app route (no query/hash). */
  path: string;
  /** Epoch ms of the last visit. */
  at: number;
}

/** Stored recents, newest first. Malformed storage or storage errors yield []. */
export function readRecentRoutes(): RecentRoute[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: RecentRoute[] = [];
    for (const v of parsed) {
      const p = (v as RecentRoute | null)?.path;
      const at = (v as RecentRoute | null)?.at;
      if (typeof p !== "string" || typeof at !== "number" || seen.has(p)) continue;
      seen.add(p);
      out.push({ path: p, at });
    }
    return out.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

const subscribers = new Set<(r: RecentRoute[]) => void>();

/** Record a visit. Ignores paths that don't resolve to an app frame; dedupes; keeps the last 6. */
export function recordRecentRoute(rawPath: string): void {
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  if (!resolveAppFrame(path)) return;
  const next = [{ path, at: Date.now() }, ...readRecentRoutes().filter((r) => r.path !== path)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
  subscribers.forEach((notify) => notify(next));
}

/** The last visited app routes, newest first. Callers filter by access (see HomePage). */
export function useRecentRoutes(): RecentRoute[] {
  const [recent, setRecent] = useState<RecentRoute[]>(readRecentRoutes);
  useEffect(() => {
    subscribers.add(setRecent);
    return () => {
      subscribers.delete(setRecent);
    };
  }, []);
  return recent;
}

/** Records the current pathname as a visit whenever it changes. Mount once inside the app frame. */
export function useRecordRecentRoute(pathname: string): void {
  const record = useCallback(recordRecentRoute, []);
  useEffect(() => record(pathname), [pathname, record]);
}
