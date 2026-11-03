import { useCallback, useEffect, useState } from "react";
import { resolveAppFrame } from "../components/AppPage";
import { ADMIN_MODULES, PUBLIC_MODULES } from "../config/modules";
import { useAuth } from "../shell/AuthContext";

/** localStorage key prefix for recently visited app routes; stored per user (`funkedupshift_recent:<userId>`) so shared devices don't leak history. */
export const RECENT_KEY = "funkedupshift_recent";
const keyFor = (userId: string) => `${RECENT_KEY}:${userId}`;
const MAX_RECENT = 6;

export interface RecentRoute {
  /** Pathname of the visited app route (no query/hash). */
  path: string;
  /** Epoch ms of the last visit. */
  at: number;
}

/** Stored recents, newest first. Malformed storage or storage errors yield []. */
export function readRecentRoutes(userId?: string | null): RecentRoute[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: RecentRoute[] = [];
    for (const v of parsed) {
      const raw = (v as RecentRoute | null)?.path;
      const at = (v as RecentRoute | null)?.at;
      if (typeof raw !== "string" || typeof at !== "number") continue;
      const p = moduleRoot(raw); // older entries may hold sub-pages
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push({ path: p, at });
    }
    return out.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** The module's own path for any page inside it (e.g. /websites/abc → /websites), so recents list one row per module.
 *  Returns null for paths that aren't an app frame. */
export function moduleRoot(rawPath: string): string | null {
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  const frame = resolveAppFrame(path);
  if (!frame) return null;
  if (frame.kind === "admin") return frame.adminId ? (ADMIN_MODULES.find((m) => m.id === frame.adminId)?.path ?? "/admin") : "/admin";
  if (frame.publicId) return PUBLIC_MODULES.find((m) => m.id === frame.publicId)?.path ?? path;
  return path;
}

const subscribers = new Set<(userId: string, r: RecentRoute[]) => void>();

/** Record a visit for `userId` (no-op for guests). Ignores paths that don't resolve to an app frame; every page is
 *  stored as its module path (see moduleRoot), so record ids are never kept and each module appears once; keeps the last 6. */
export function recordRecentRoute(rawPath: string, userId?: string | null): void {
  if (!userId) return;
  const path = moduleRoot(rawPath);
  if (!path) return;
  const next = [{ path, at: Date.now() }, ...readRecentRoutes(userId).filter((r) => r.path !== path)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
  subscribers.forEach((notify) => notify(userId, next));
}

/** The signed-in user's last visited app routes, newest first. Callers filter by access (see Dashboard). */
export function useRecentRoutes(): RecentRoute[] {
  const { user } = useAuth();
  const userId = user?.userId ?? null;
  const [recent, setRecent] = useState<RecentRoute[]>(() => readRecentRoutes(userId));
  useEffect(() => {
    setRecent(readRecentRoutes(userId));
    const notify = (id: string, r: RecentRoute[]) => id === userId && setRecent(r);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, [userId]);
  return recent;
}

/** Records the current pathname as a visit for the signed-in user whenever it changes. Mount once inside the app frame. */
export function useRecordRecentRoute(pathname: string): void {
  const { user } = useAuth();
  const userId = user?.userId ?? null;
  useEffect(() => recordRecentRoute(pathname, userId), [pathname, userId]);
}
