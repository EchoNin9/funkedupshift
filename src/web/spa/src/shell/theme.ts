import { useEffect, useState, useSyncExternalStore } from "react";
import { saveProfilePrefs } from "./profilePrefs";

/* Themes + dark/light mode (README §9). A theme is {id, name, tint, accent, discover, tools, modules, admin};
   the full token set is derived from it at runtime (port of themeCSS() in the handoff prototype) and written
   to a <style> element keyed on <html data-palette data-theme>. Server state: GET /themes, GET /site-settings;
   per-user choice: themeId + mode on the profile (PUT /profile) with localStorage as the first-paint cache. */

export type ThemeMode = "dark" | "light";
/** @deprecated alias kept for older imports. */
export type Theme = ThemeMode;

export interface ThemeRecord {
  id: string;
  name: string;
  /** Ground hue, 0–360. */
  tint: number;
  accent: string;
  discover: string;
  tools: string;
  modules: string;
  admin: string;
  builtin?: boolean;
}

/** Offline / API-down fallback; mirrors the backend seed. */
export const BUILTIN_THEMES: ThemeRecord[] = [
  { id: "funk", name: "Funk", tint: 285, accent: "#7c5cff", discover: "#33c9aa", tools: "#9a82ff", modules: "#ff7f5c", admin: "#f2b73f", builtin: true },
  { id: "ember", name: "Ember", tint: 45, accent: "#ff6a3d", discover: "#f2b73f", tools: "#ff8fab", modules: "#b18cff", admin: "#5fd0a0", builtin: true },
  { id: "lagoon", name: "Lagoon", tint: 230, accent: "#3d7bff", discover: "#2ec4b6", tools: "#8fa8ff", modules: "#ffb454", admin: "#ff7a93", builtin: true },
  { id: "neon", name: "Neon", tint: 150, accent: "#a3e635", discover: "#22d3ee", tools: "#f472b6", modules: "#facc15", admin: "#fb923c", builtin: true },
];
export const FALLBACK_THEME_ID = "funk";

/* ---------- colour maths (hex ⇄ oklch, oklch mixing with white/black) ---------- */

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [124, 92, 255];
}
const toLinear = (v: number) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLinear = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

/** Relative luminance (WCAG) of an RGB triple. */
function luminance([r, g, b]: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function rgbToOklch([r, g, b]: RGB): [number, number, number] {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), (Math.atan2(bb, a) * 180) / Math.PI];
}

function oklchToRgb(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** color-mix(in oklch, c p%, white|black): lightness mixes, chroma scales, hue is kept (the target is achromatic). */
function mixOklch(c: RGB, p: number, target: 0 | 1): RGB {
  const [L, C, h] = rgbToOklch(c);
  const k = p / 100;
  return oklchToRgb(L * k + target * (1 - k), C * k, h);
}
const mixW = (c: string, p: number): RGB => mixOklch(hexToRgb(c), p, 1);
const mixB = (c: string, p: number): RGB => mixOklch(hexToRgb(c), p, 0);
const oklch = (L: number, C: number, h: number): RGB => oklchToRgb(L, C, h);
const trip = ([r, g, b]: RGB) => `${r} ${g} ${b}`;
const blend = (fg: RGB, bg: RGB, pct: number): RGB =>
  [0, 1, 2].map((i) => Math.round(fg[i] * (pct / 100) + bg[i] * (1 - pct / 100))) as RGB;

/** The CSS custom properties a theme sets for one mode. Colour tokens are "R G B" triplets (Tailwind adds alpha). */
export function themeVars(th: ThemeRecord, mode: ThemeMode): Record<string, string> {
  const h = Number(th.tint) || 0;
  const dark = mode === "dark";
  const bg = dark ? oklch(0.17, 0.012, h) : oklch(0.975, 0.005, h);
  const s1 = dark ? oklch(0.187, 0.013, h) : oklch(0.985, 0.0035, h);
  const s2 = dark ? oklch(0.205, 0.014, h) : oklch(0.995, 0.002, h);
  const s3 = dark ? oklch(0.245, 0.016, h) : oklch(0.945, 0.009, h);
  const text = dark ? oklch(0.95, 0.006, h) : oklch(0.2, 0.015, h);
  const muted = dark ? oklch(0.74, 0.018, h) : oklch(0.47, 0.02, h);
  const faint = dark ? oklch(0.66, 0.018, h) : oklch(0.52, 0.02, h);

  const accent = dark ? hexToRgb(th.accent) : mixB(th.accent, 86);
  const accentHover = dark ? mixW(th.accent, 84) : mixB(th.accent, 76);
  const accentText = dark ? mixW(th.accent, 68) : mixB(th.accent, 70);
  const accentLight = dark ? accentText : hexToRgb(th.accent);
  // Flip to dark text on bright accents so button labels keep their contrast.
  const onAccent: RGB = luminance(accent) > 0.3 ? [20, 18, 26] : [251, 250, 255];

  const hue = (c: string): RGB => (dark ? hexToRgb(c) : mixB(c, 74));
  const teal = hue(th.discover), violet = hue(th.tools), coral = hue(th.modules), amber = hue(th.admin);

  const vars: Record<string, string> = {
    "--color-surface-0": trip(bg),
    "--color-surface-1": trip(s1),
    "--color-surface-2": trip(s2),
    "--color-surface-3": trip(s3),
    "--color-border-default": trip(blend(text, bg, dark ? 11 : 10)),
    "--color-border-subtle": trip(blend(text, bg, dark ? 6 : 6)),
    "--color-border-hover": trip(blend(text, bg, dark ? 24 : 22)),
    "--color-text-primary": trip(text),
    "--color-text-secondary": trip(muted),
    "--color-text-tertiary": trip(faint),
    "--color-accent": trip(accent),
    "--color-accent-hover": trip(accentHover),
    "--color-accent-light": trip(accentLight),
    "--color-accent-text": trip(accentText),
    "--color-on-accent": trip(onAccent),
    "--color-hue-teal": trip(teal),
    "--color-hue-violet": trip(violet),
    "--color-hue-coral": trip(coral),
    "--color-hue-amber": trip(amber),
    // Legacy Neon Pop aliases (n1 accent, n2 amber, n3 teal, n4 coral) — fills stay bright, text variants deepen.
    "--color-n1": trip(accent),
    "--color-n2": trip(hexToRgb(th.admin)),
    "--color-n3": trip(hexToRgb(th.discover)),
    "--color-n4": trip(hexToRgb(th.modules)),
    "--color-nav": trip(hexToRgb(th.discover)),
    "--color-n1-text": trip(accentText),
    "--color-n2-text": trip(amber),
    "--color-n3-text": trip(teal),
    "--color-n4-text": trip(coral),
    "--color-nav-text": trip(teal),
    "--color-ink": trip(dark ? bg : text),
  };
  const tc = trip(text);
  vars["--color-divider"] = `color-mix(in srgb, rgb(${tc}) ${dark ? 11 : 10}%, transparent)`;
  vars["--color-border-strong"] = `color-mix(in srgb, rgb(${tc}) ${dark ? 24 : 22}%, transparent)`;
  return vars;
}

const block = (vars: Record<string, string>) =>
  Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");

/** Stylesheet text for one theme, both modes. Selectors out-rank :root / :root[data-theme="light"] in styles.css. */
export function themeCSS(th: ThemeRecord): string {
  return (
    `html[data-palette]:not([data-theme="light"]){${block(themeVars(th, "dark"))}}\n` +
    `html[data-palette][data-theme="light"]{${block(themeVars(th, "light"))}}`
  );
}

/* ---------- store ---------- */

const MODE_KEY = "funkedupshift_theme"; // existing key: mode cache (guests' source of truth)
const ID_KEY = "funkedupshift_theme_id"; // signed-in user's theme choice (cache)
const CATALOG_KEY = "funkedupshift_themes"; // last themes + site defaults, for instant first paint
const STYLE_ID = "fus-theme-css";

interface ThemeState {
  themes: ThemeRecord[];
  defaultThemeId: string;
  defaultMode: ThemeMode;
  /** The user's explicit pick; null = follow the site default. */
  selectedThemeId: string | null;
  /** The explicit mode; null = follow the site default. */
  selectedMode: ThemeMode | null;
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — in-memory only */
  }
}

const isMode = (v: unknown): v is ThemeMode => v === "dark" || v === "light";
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

function cleanTheme(t: any): ThemeRecord | null {
  if (!t || typeof t.id !== "string" || typeof t.name !== "string") return null;
  const tint = Number(t.tint);
  if (!Number.isFinite(tint)) return null;
  const colors = [t.accent, t.discover, t.tools, t.modules, t.admin];
  if (!colors.every(isHex)) return null;
  return {
    id: t.id, name: t.name, tint,
    accent: t.accent, discover: t.discover, tools: t.tools, modules: t.modules, admin: t.admin,
    builtin: !!t.builtin,
  };
}

function readCachedCatalog(): Pick<ThemeState, "themes" | "defaultThemeId" | "defaultMode"> {
  const fallback = { themes: BUILTIN_THEMES, defaultThemeId: FALLBACK_THEME_ID, defaultMode: "dark" as ThemeMode };
  try {
    const raw = lsGet(CATALOG_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    const themes = (Array.isArray(p?.themes) ? p.themes : []).map(cleanTheme).filter((t: ThemeRecord | null): t is ThemeRecord => !!t);
    if (!themes.length) return fallback;
    return {
      themes,
      defaultThemeId: typeof p.defaultThemeId === "string" ? p.defaultThemeId : FALLBACK_THEME_ID,
      defaultMode: isMode(p.defaultMode) ? p.defaultMode : "dark",
    };
  } catch {
    return fallback;
  }
}

let state: ThemeState = {
  ...readCachedCatalog(),
  selectedThemeId: lsGet(ID_KEY),
  selectedMode: (() => {
    const m = lsGet(MODE_KEY);
    return isMode(m) ? m : null;
  })(),
};
const listeners = new Set<() => void>();

export function resolveTheme(s: ThemeState): ThemeRecord {
  const byId = (id: string | null) => (id ? s.themes.find((t) => t.id === id) : undefined);
  return byId(s.selectedThemeId) ?? byId(s.defaultThemeId) ?? s.themes[0] ?? BUILTIN_THEMES[0];
}
export const resolveMode = (s: ThemeState): ThemeMode => s.selectedMode ?? s.defaultMode;

/** Push the resolved theme/mode onto <html> and refresh the generated stylesheet. */
function apply(): void {
  if (typeof document === "undefined") return;
  const th = resolveTheme(state);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveMode(state));
  root.setAttribute("data-palette", th.id);
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const css = themeCSS(th);
  if (el.textContent !== css) el.textContent = css;
}

function commit(patch: Partial<ThemeState>): void {
  state = { ...state, ...patch };
  apply();
  listeners.forEach((l) => l());
}

/** Apply cached theme/mode before React renders (called from main.tsx) so there is no flash of the wrong theme. */
export function initTheme(): void {
  apply();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export interface ThemeView {
  themes: ThemeRecord[];
  defaultThemeId: string;
  defaultMode: ThemeMode;
  /** The theme currently applied. */
  theme: ThemeRecord;
  mode: ThemeMode;
}
let view: { src: ThemeState; out: ThemeView } | null = null;
function getView(): ThemeView {
  if (!view || view.src !== state) {
    view = {
      src: state,
      out: {
        themes: state.themes,
        defaultThemeId: state.defaultThemeId,
        defaultMode: state.defaultMode,
        theme: resolveTheme(state),
        mode: resolveMode(state),
      },
    };
  }
  return view.out;
}

/** Reactive view of the theme store. */
export function useThemeState(): ThemeView {
  return useSyncExternalStore(subscribe, getView, getView);
}

/* ---------- actions ---------- */

export function getTheme(): ThemeMode {
  return resolveMode(state);
}

/** Back-compat: set the mode (persisted + synced). */
export function setTheme(t: ThemeMode): void {
  setMode(t);
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getTheme() === "dark" ? "light" : "dark";
  setMode(next);
  return next;
}

export function applyTheme(t: ThemeMode): void {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", t);
}

/** Choose dark/light. Cached locally; saved to the profile when signed in (debounced, last write wins). */
export function setMode(mode: ThemeMode): void {
  lsSet(MODE_KEY, mode);
  commit({ selectedMode: mode });
  void saveProfilePrefs({ mode });
}

/** Choose a theme. Cached locally; saved to the profile when signed in. */
export function setThemeId(themeId: string): void {
  lsSet(ID_KEY, themeId);
  commit({ selectedThemeId: themeId });
  void saveProfilePrefs({ themeId });
}

/** Adopt the profile's (server-resolved) choice without writing it back. */
export function applyServerPrefs(prefs: { themeId?: string; mode?: string }): void {
  const patch: Partial<ThemeState> = {};
  if (typeof prefs.themeId === "string" && prefs.themeId) {
    // The server resolves "no preference" to the site default; keep following the default in that case.
    patch.selectedThemeId = prefs.themeId === state.defaultThemeId ? null : prefs.themeId;
    lsSet(ID_KEY, patch.selectedThemeId);
  }
  if (isMode(prefs.mode)) {
    patch.selectedMode = prefs.mode;
    lsSet(MODE_KEY, prefs.mode);
  }
  commit(patch);
}

/** Sign-out: guests get the site-default theme; their mode choice (localStorage) is kept. */
export function resetUserTheme(): void {
  lsSet(ID_KEY, null);
  commit({ selectedThemeId: null });
}

function apiBase(): string | null {
  const raw = typeof window !== "undefined" ? ((window as any).API_BASE_URL as string | undefined) : undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

let catalogPromise: Promise<void> | null = null;

/** Read themes + site settings (public endpoints). On failure keep the cached / built-in catalogue. */
export function refreshCatalog(): Promise<void> {
  const base = apiBase();
  if (!base) return Promise.resolve();
  const p = (async () => {
    try {
      const [tr, sr] = await Promise.all([fetch(`${base}/themes`), fetch(`${base}/site-settings`)]);
      if (!tr.ok) return;
      const td = await tr.json();
      const themes = (Array.isArray(td?.themes) ? td.themes : []).map(cleanTheme).filter((t: ThemeRecord | null): t is ThemeRecord => !!t);
      if (!themes.length) return;
      let defaultThemeId: string = typeof td.defaultThemeId === "string" ? td.defaultThemeId : state.defaultThemeId;
      let defaultMode = state.defaultMode;
      if (sr.ok) {
        const sd = await sr.json();
        if (typeof sd?.defaultThemeId === "string") defaultThemeId = sd.defaultThemeId;
        if (isMode(sd?.defaultMode)) defaultMode = sd.defaultMode;
      }
      lsSet(CATALOG_KEY, JSON.stringify({ themes, defaultThemeId, defaultMode }));
      commit({ themes, defaultThemeId, defaultMode });
    } catch {
      /* API down — keep what we have */
    }
  })();
  return p;
}

/** Once-per-page-load catalogue fetch (shared promise). */
export function loadCatalog(): Promise<void> {
  if (!catalogPromise) catalogPromise = refreshCatalog();
  return catalogPromise;
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
