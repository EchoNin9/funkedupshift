import { useCallback, useEffect, useState } from "react";
import { canSync, saveProfilePrefs } from "../shell/profilePrefs";

/** localStorage cache of collapsed launcher group ids; the profile API (PUT /profile `collapsedGroups`) is the source of truth. */
export const COLLAPSED_KEY = "funkedupshift_collapsed_groups";
/** userId the cache belongs to, so one account's state never shows for the next signed-in user. */
export const COLLAPSED_OWNER_KEY = "funkedupshift_collapsed_groups_owner";

function readCached(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter((v): v is string => typeof v === "string"))) : [];
  } catch {
    return [];
  }
}

let cacheOwner: string | null = null;

function writeCached(ids: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
    if (cacheOwner) localStorage.setItem(COLLAPSED_OWNER_KEY, cacheOwner);
  } catch {
    /* storage unavailable — state lives in memory for this session */
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// Module-level truth shared by every mounted instance. A cache with no owner (signed-out use) is fine to show.
let current: string[] = readCached();
let confirmed: string[] = current;
const subscribers = new Set<(ids: string[]) => void>();
const emit = () => subscribers.forEach((notify) => notify(current));

/** Adopt the profile's collapsed groups (`[]` legitimately means all expanded). */
export function hydrateCollapsedGroups(serverIds: string[], userId: string): void {
  cacheOwner = userId;
  current = Array.from(new Set(serverIds));
  confirmed = current;
  writeCached(current);
  emit();
}

/** Sign-out: forget the previous user's state. */
export function resetCollapsedGroups(): void {
  try {
    localStorage.removeItem(COLLAPSED_KEY);
    localStorage.removeItem(COLLAPSED_OWNER_KEY);
  } catch {
    /* ignore */
  }
  cacheOwner = null;
  current = [];
  confirmed = [];
  emit();
}

function applyCollapsed(next: string[]): void {
  current = next;
  writeCached(next);
  emit();
  if (!canSync()) return; // signed out / impersonating: local only
  void saveProfilePrefs({ collapsedGroups: next }).then((r) => {
    if (r === "ok") confirmed = next;
    else if (r === "failed" && sameList(current, next)) {
      current = confirmed;
      writeCached(current);
      emit();
    }
  });
}

/** Collapsed launcher group ids, shared across instances. */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<string[]>(current);

  useEffect(() => {
    setCollapsed(current);
    subscribers.add(setCollapsed);
    return () => {
      subscribers.delete(setCollapsed);
    };
  }, []);

  const isCollapsed = useCallback((id: string) => collapsed.includes(id), [collapsed]);
  const toggleCollapsed = useCallback(
    (id: string) => applyCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]),
    [collapsed]
  );

  return { collapsed, isCollapsed, toggleCollapsed };
}
