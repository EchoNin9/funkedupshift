import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../shell/AuthContext";
import { canSync, saveProfilePrefs } from "../shell/profilePrefs";

/** localStorage key for the pinned app ids — a cache; the profile API (PUT /profile `pins`) is the source of truth. */
export const PINS_KEY = "funkedupshift_pins";
/** userId the cached pins belong to. A cache written by a different user (shared browser, session expired
 *  without sign-out) must never seed the next user's server pins. */
export const PINS_OWNER_KEY = "funkedupshift_pins_owner";

/** Defaults for a user who has never pinned/unpinned anything: URL Shortener, Websites, Finances,
 *  Vehicle Expenses, Squash, Media. NB the URL Shortener's id in config/modules.ts is "tools". */
export const DEFAULT_PINS: readonly string[] = ["tools", "websites", "finances", "vehicles-expenses", "squash", "media"];

/** Stored ids, or the defaults when nothing valid is stored. A stored `[]` is respected (user unpinned everything). */
export function readPins(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (raw === null) return [...DEFAULT_PINS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PINS];
    return Array.from(new Set(parsed.filter((v): v is string => typeof v === "string")));
  } catch {
    return [...DEFAULT_PINS];
  }
}

/** Owner of the in-memory/cached pins; null until the profile has hydrated (nothing is written to the cache then). */
let cacheOwner: string | null = null;

function writePins(pins: string[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
    if (cacheOwner) localStorage.setItem(PINS_OWNER_KEY, cacheOwner);
  } catch {
    /* storage unavailable — pins live in memory for this session */
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Module-level truth shared by every mounted usePins() instance (launcher + app-page Pin button) so a toggle
 *  in one place updates the others in the same tab; the `storage` event only fires in other tabs. */
let current: string[] = readPins();
/** Last list the server confirmed (or the cache we started from) — what a failed save reverts to. */
let confirmed: string[] = current;
const subscribers = new Set<(pins: string[]) => void>();
const emit = () => subscribers.forEach((notify) => notify(current));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PINS_KEY || e.key === null) {
      current = readPins();
      emit();
    }
  });
}

/** Adopt the profile's pins. The API cannot tell "never set" from "unpinned everything" (both come back `[]`),
 *  so an empty server list keeps the local cache and, if that holds explicit pins, seeds the server with them. */
export function hydratePins(serverPins: string[], userId: string): void {
  let cacheIsOurs = false;
  try {
    cacheIsOurs = localStorage.getItem(PINS_OWNER_KEY) === userId;
    if (!cacheIsOurs) {
      // Someone else's (or an unowned legacy) cache: drop it before readPins() can pick it up.
      localStorage.removeItem(PINS_KEY);
      localStorage.removeItem(PINS_OWNER_KEY);
    }
  } catch {
    /* storage unavailable */
  }
  cacheOwner = userId;
  if (serverPins.length > 0) {
    current = Array.from(new Set(serverPins));
    confirmed = current;
    writePins(current);
    emit();
    return;
  }
  current = readPins();
  confirmed = current;
  emit();
  if (cacheIsOurs && current.length > 0 && localStorage.getItem(PINS_KEY) !== null && canSync()) {
    void saveProfilePrefs({ pins: current });
  }
}

/** Sign-out: forget the previous user's pins so the next sign-in on this browser starts clean. */
export function resetPins(): void {
  try {
    localStorage.removeItem(PINS_KEY);
    localStorage.removeItem(PINS_OWNER_KEY);
  } catch {
    /* ignore */
  }
  cacheOwner = null;
  current = [...DEFAULT_PINS];
  confirmed = current;
  emit();
}

function applyPins(next: string[]): void {
  const clean = Array.from(new Set(next));
  current = clean;
  writePins(clean);
  emit();
  if (!canSync()) return; // impersonating (or signed out): keep the change local, never write to the effective user
  void saveProfilePrefs({ pins: clean }).then((r) => {
    if (r === "ok") confirmed = clean;
    else if (r === "failed" && sameList(current, clean)) {
      // Optimistic update rejected and nothing newer has happened: revert and keep the cache consistent.
      current = confirmed;
      writePins(current);
      emit();
    }
  });
}

/** Pinned app ids — profile API with a localStorage cache, kept in sync across instances and tabs. Guests have no pins. */
export function usePins() {
  const { user } = useAuth();
  const [all, setAll] = useState<string[]>(current);

  useEffect(() => {
    setAll(current);
    subscribers.add(setAll);
    return () => {
      subscribers.delete(setAll);
    };
  }, []);

  const pins = user ? all : [];

  const setPins = useCallback(
    (next: string[]) => {
      if (user) applyPins(next);
    },
    [user]
  );

  const isPinned = useCallback((id: string) => pins.includes(id), [pins]);

  const togglePin = useCallback(
    (id: string) => setPins(pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]),
    [pins, setPins]
  );

  return { pins, isPinned, togglePin, setPins };
}
