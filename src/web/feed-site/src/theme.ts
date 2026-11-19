export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "color-scheme";

export function readStoredTheme(storage: Pick<Storage, "getItem"> | null | undefined = undefined): ThemePreference {
  try {
    const store = storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
    const raw = store?.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // Ignore storage access errors in restricted privacy contexts
  }
  return "system";
}

export function computeQuickToggleTarget(stored: ThemePreference, osDark: boolean): ThemePreference {
  const currentRendered = stored !== "system" ? stored : osDark ? "dark" : "light";
  const target: "light" | "dark" = currentRendered === "dark" ? "light" : "dark";
  // Returning to the OS default removes the override instead of pinning it.
  if ((target === "dark") === osDark) return "system";
  return target;
}

export function applyThemePreference(pref: ThemePreference): void {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute("content", pref === "system" ? "light dark" : pref);
    }
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (pref === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, pref);
      }
    }
  } catch {
    // Ignore storage write errors
  }
}
