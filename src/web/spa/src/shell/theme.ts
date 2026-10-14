import { useEffect, useState } from "react";

/* Neon Pop dark/light theme — swaps data-theme on <html>, persisted. Default dark. (FUNK-3) */
const KEY = "funkedupshift_theme";
export type Theme = "dark" | "light";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", t);
  }
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  applyTheme(t);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** Current data-theme on <html>; re-renders on change (for canvas charts that read CSS vars once). */
export function useThemeName(): string {
  const read = () => document.documentElement.getAttribute("data-theme") ?? "dark";
  const [name, setName] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setName(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return name;
}
