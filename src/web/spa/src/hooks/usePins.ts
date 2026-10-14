import { useCallback, useEffect, useState } from "react";

/** localStorage key for the pinned app ids (themes-ui later moves the source of truth to the profile API). */
export const PINS_KEY = "funkedupshift_pins";

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

function writePins(pins: string[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* storage unavailable — pins live in memory for this session */
  }
}

/** Pinned app ids, persisted in localStorage and kept in sync across tabs. Hook only — no UI. */
export function usePins() {
  const [pins, setPinsState] = useState<string[]>(readPins);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PINS_KEY || e.key === null) setPinsState(readPins());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPins = useCallback((next: string[]) => {
    const clean = Array.from(new Set(next));
    setPinsState(clean);
    writePins(clean);
  }, []);

  const isPinned = useCallback((id: string) => pins.includes(id), [pins]);

  const togglePin = useCallback(
    (id: string) => setPins(pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]),
    [pins, setPins]
  );

  return { pins, isPinned, togglePin, setPins };
}
