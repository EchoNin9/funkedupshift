import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

export interface OpenLauncherOptions {
  /** Focus the search input once the drawer is open (top-bar search trigger, ⌘K, tab bar). */
  focusSearch?: boolean;
}

interface LauncherContextValue {
  open: boolean;
  /** True when the drawer was opened asking for the search box to take focus. */
  focusSearch: boolean;
  openLauncher: (opts?: OpenLauncherOptions) => void;
  closeLauncher: () => void;
  toggleLauncher: (opts?: OpenLauncherOptions) => void;
}

const noop = () => {};
const fallback: LauncherContextValue = {
  open: false,
  focusSearch: false,
  openLauncher: noop,
  closeLauncher: noop,
  toggleLauncher: noop,
};

const LauncherContext = createContext<LauncherContextValue>(fallback);

/** Owns the launcher open state and the global ⌘K / Ctrl+K shortcut. Focus is returned to whatever opened the drawer. */
export const LauncherProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [focusSearch, setFocusSearch] = useState(false);
  const openRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openLauncher = useCallback((opts?: OpenLauncherOptions) => {
    if (!openRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    openRef.current = true;
    setFocusSearch(!!opts?.focusSearch);
    setOpen(true);
  }, []);

  const closeLauncher = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    setFocusSearch(false);
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el && el.isConnected) requestAnimationFrame(() => el.focus());
  }, []);

  const toggleLauncher = useCallback(
    (opts?: OpenLauncherOptions) => (openRef.current ? closeLauncher() : openLauncher(opts)),
    [openLauncher, closeLauncher]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleLauncher({ focusSearch: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleLauncher]);

  // Android hardware back: close the launcher / account sheet, else history back, else exit. No-op on web.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener("backButton", ({ canGoBack }) => {
      if (openRef.current) closeLauncher();
      else if (document.querySelector('[role="menu"]')) document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (canGoBack) window.history.back();
      else void CapApp.exitApp();
    });
    return () => {
      void h.then((l) => l.remove());
    };
  }, [closeLauncher]);

  const value = useMemo(
    () => ({ open, focusSearch, openLauncher, closeLauncher, toggleLauncher }),
    [open, focusSearch, openLauncher, closeLauncher, toggleLauncher]
  );
  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>;
};

/** Safe outside the provider (native shell): returns inert no-ops. */
export function useLauncher(): LauncherContextValue {
  return useContext(LauncherContext);
}
