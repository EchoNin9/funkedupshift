import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { House, Lock, MagnifyingGlass, PushPin, X } from "@phosphor-icons/react";
import {
  getLauncherGroups,
  type LauncherApp,
  type LauncherGroup,
  type LauncherGroupId,
} from "../config/modules";
import { usePins } from "../hooks/usePins";
import { useAuth } from "./AuthContext";
import { useLauncher } from "./LauncherContext";
import { useKeyboardInset, useNarrow } from "./useNarrow";

const GROUP_HUE: Record<LauncherGroupId | "pinned", string> = {
  discover: "hue-teal",
  tools: "hue-violet",
  modules: "hue-coral",
  pinned: "hue-amber",
};

const FOCUSABLE = 'a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])';

function matches(app: LauncherApp, q: string): boolean {
  return app.label.toLowerCase().includes(q) || app.description.toLowerCase().includes(q);
}

interface TileProps {
  app: LauncherApp;
  hue: string;
  current: boolean;
  canPin: boolean;
  pinned: boolean;
  onTogglePin: (id: string) => void;
  onNavigate: (path: string) => void;
}

function AppTile({ app, hue, current, canPin, pinned, onTogglePin, onNavigate }: TileProps) {
  const Icon = app.icon;
  const guestLocked = app.locked && app.lockReason === "guest";
  const inert = app.locked && app.lockReason === "no-access";
  const target = guestLocked ? "/auth" : app.path;
  const inner = (
    <>
      <span className={`app-icon ${hue} relative h-[46px] w-[46px] rounded-[13px]`}>
        <Icon className="h-[23px] w-[23px]" />
        {app.locked && (
          <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-[color:var(--color-divider)] bg-surface-3 text-text-secondary">
            <Lock size={11} weight="fill" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-xs font-semibold text-text-primary">{app.label}</span>
    </>
  );
  const base =
    "flex w-full flex-col items-center gap-2 rounded-[10px] px-1.5 pb-2.5 pt-3 transition-colors hover:bg-surface-2";
  const state = `${app.locked ? "is-locked" : ""} ${current ? "is-current" : ""}`;

  return (
    <li className="relative">
      {inert ? (
        <div
          className={`${base} ${state} is-inert`}
          title={`${app.label} — ask an admin for access`}
          aria-disabled="true"
        >
          {inner}
        </div>
      ) : (
        <Link
          to={target}
          onClick={() => onNavigate(target)}
          className={`${base} ${state}`}
          title={guestLocked ? `${app.label} — sign in to open` : app.description}
          aria-current={current ? "page" : undefined}
        >
          {inner}
        </Link>
      )}
      {canPin && !app.locked && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTogglePin(app.id);
          }}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${app.label}` : `Pin ${app.label}`}
          title={pinned ? "Unpin" : "Pin"}
          className={`pin-toggle ${pinned ? "is-pinned" : ""} absolute right-0.5 top-0.5 grid h-6 w-6 max-[640px]:right-0 max-[640px]:top-0 max-[640px]:h-11 max-[640px]:w-11 place-items-center rounded-md text-text-secondary hover:text-text-primary ${pinned ? "!text-accent-text" : ""}`}
        >
          <PushPin size={14} weight={pinned ? "fill" : "regular"} />
        </button>
      )}
    </li>
  );
}

function SectionLabel({ hue, label, count }: { hue: string; label: string; count: number }) {
  return (
    <div className={`${hue} flex items-center gap-2 px-2 pb-1 pt-4`}>
      <span className="hue-dot h-[7px] w-[7px] rounded-full" aria-hidden="true" />
      <h3 className="text-xs font-bold uppercase tracking-[.06em] text-text-secondary">{label}</h3>
      <span className="text-xs text-text-tertiary">{count}</span>
    </div>
  );
}

/** Left slide-out app launcher (README §2). Open state lives in LauncherContext. */
export function LauncherDrawer() {
  const { open, focusSearch, closeLauncher } = useLauncher();
  const { user } = useAuth();
  const { pins, isPinned, togglePin } = usePins();
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const narrow = useNarrow();
  const kbd = useKeyboardInset(open && narrow);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const signedIn = !!user && user.role !== "guest";
  const groups = useMemo<LauncherGroup[]>(() => getLauncherGroups(user), [user]);
  const allApps = useMemo(() => groups.flatMap((g) => g.apps), [groups]);
  const lockedCount = allApps.filter((a) => a.locked).length;
  const q = query.trim().toLowerCase();

  const visibleGroups = useMemo(
    () => groups.map((g) => ({ ...g, apps: q ? g.apps.filter((a) => matches(a, q)) : g.apps })).filter((g) => g.apps.length > 0),
    [groups, q]
  );
  const pinnedApps = useMemo(
    () => (signedIn && !q ? pins.map((id) => allApps.find((a) => a.id === id)).filter((a): a is LauncherApp => !!a && !a.locked) : []),
    [signedIn, q, pins, allApps]
  );
  const showHome = !q || "home dashboard".includes(q);
  const matchCount = visibleGroups.reduce((n, g) => n + g.apps.length, 0);

  const isCurrent = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  // Reset the search each time the drawer opens; focus the field (or the panel) once it mounts.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = window.setTimeout(() => {
      if (focusSearch) searchRef.current?.focus();
      else panelRef.current?.querySelector<HTMLElement>("button,a")?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, focusSearch]);

  // Lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on route change (e.g. back button).
  useEffect(() => {
    closeLauncher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeLauncher();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [closeLauncher]
  );

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const first = visibleGroups[0]?.apps[0];
    if (!first) return;
    const guestLocked = first.locked && first.lockReason === "guest";
    if (first.locked && !guestLocked) return;
    closeLauncher();
    navigate(guestLocked ? "/auth" : first.path);
  };

  const dur = (s: number) => (reduceMotion ? 0 : s);
  const tile = (app: LauncherApp, hue: string) => (
    <AppTile
      key={app.id}
      app={app}
      hue={hue}
      current={isCurrent(app.path)}
      canPin={signedIn}
      pinned={isPinned(app.id)}
      onTogglePin={togglePin}
      onNavigate={() => closeLauncher()}
    />
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="launcher-scrim is-open fixed inset-0 z-50 !transition-none"
            style={{ background: "color-mix(in srgb, #08080c 55%, transparent)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur(0.2) }}
            onClick={closeLauncher}
            aria-hidden="true"
          />
          <motion.aside
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Apps"
            onKeyDown={onKeyDown}
            className="launcher is-open z-[51] flex flex-col bg-surface-1 shadow-ds-lg !transition-none"
            // ≤640px: bottom sheet sliding on Y; above that: left drawer sliding on X. Lift above the soft keyboard when it is up.
            style={narrow && kbd ? { bottom: kbd.bottom, height: Math.min(kbd.height * 0.96, 720) } : undefined}
            initial={narrow ? { y: "104%" } : { x: "-104%" }}
            animate={narrow ? { y: 0 } : { x: 0 }}
            exit={narrow ? { y: "104%" } : { x: "-104%" }}
            transition={{ duration: dur(0.26), ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="only-narrow justify-center pt-2" aria-hidden="true">
              <span className="h-1 w-9 rounded-full bg-surface-3" />
            </div>
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="font-display text-xl font-semibold text-text-primary">Apps</h2>
              <button
                type="button"
                onClick={closeLauncher}
                aria-label="Close apps"
                className="grid h-11 w-11 place-items-center rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary min-[641px]:h-9 min-[641px]:w-9"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pb-2">
              <label className="flex h-10 items-center gap-2 rounded-[10px] border bg-surface-0 px-3 max-[640px]:h-11 focus-within:ring-2 focus-within:ring-accent-500" style={{ borderColor: "var(--color-divider)" }}>
                <MagnifyingGlass size={16} className="shrink-0 text-text-tertiary" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder={`Search ${allApps.length} apps`}
                  aria-label={`Search ${allApps.length} apps`}
                  className="min-w-0 flex-1 bg-transparent text-sm max-[640px]:text-base text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 scrollbar-thin" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              {showHome && (
                <Link
                  to="/"
                  onClick={() => closeLauncher()}
                  className={`mt-1 flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-surface-2 ${location.pathname === "/" ? "is-current" : ""}`}
                >
                  <span className="app-icon hue-teal h-[34px] w-[34px] rounded-[10px]">
                    <House size={18} />
                  </span>
                  <span className="text-sm font-semibold text-text-primary">{signedIn ? "Home — your dashboard" : "Home"}</span>
                </Link>
              )}

              {pinnedApps.length > 0 && (
                <section aria-label="Pinned">
                  <SectionLabel hue={GROUP_HUE.pinned} label="Pinned" count={pinnedApps.length} />
                  <ul className="grid grid-cols-3 gap-1">{pinnedApps.map((a) => tile(a, GROUP_HUE[a.group]))}</ul>
                </section>
              )}

              {visibleGroups.map((g) => (
                <section key={g.id} aria-label={g.label}>
                  <SectionLabel hue={GROUP_HUE[g.id]} label={g.label} count={g.apps.length} />
                  <ul className="grid grid-cols-3 gap-1">{g.apps.map((a) => tile(a, GROUP_HUE[g.id]))}</ul>
                </section>
              ))}

              {q && matchCount === 0 && (
                <p className="px-3 py-10 text-center text-sm text-text-secondary" role="status">
                  No apps match “{query.trim()}”.
                </p>
              )}
            </div>

            <div className="only-wide flex items-center gap-3 border-t px-5 py-3 text-xs text-text-tertiary" style={{ borderColor: "var(--color-divider)" }}>
              <span><kbd className="font-sans font-semibold text-text-secondary">⌘K</kbd> open</span>
              <span><kbd className="font-sans font-semibold text-text-secondary">Esc</kbd> close</span>
              {lockedCount > 0 && <span>{lockedCount} locked</span>}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default LauncherDrawer;
