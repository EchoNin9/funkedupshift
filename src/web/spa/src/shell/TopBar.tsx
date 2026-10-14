import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlass, Moon, SquaresFour, Sun } from "@phosphor-icons/react";
import { useAuth } from "./AuthContext";
import { useLauncher } from "./LauncherContext";
import { AccountMenu, userInitials } from "./AccountMenu";
import { getTheme, toggleTheme, type Theme } from "./theme";

/** Desktop (>640px) top bar: launcher, wordmark, ⌘K search trigger, theme toggle, avatar / Sign in. */
export function TopBar() {
  const { user, isLoading } = useAuth();
  const { open: launcherOpen, openLauncher } = useLauncher();
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const signedIn = !!user;
  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || "");

  return (
    <header
      className="only-wide sticky top-0 z-40 flex h-[60px] items-center gap-3 border-b px-5 backdrop-blur-[14px]"
      style={{
        background: "color-mix(in srgb, var(--color-bg) 84%, transparent)",
        borderColor: "var(--color-divider)",
      }}
    >
      <button
        type="button"
        onClick={() => openLauncher()}
        aria-label="Open apps"
        aria-haspopup="dialog"
        aria-expanded={launcherOpen}
        title="Apps"
        className="btn-secondary inline-flex !h-9 !w-9 items-center justify-center !p-0"
      >
        <SquaresFour size={19} />
      </button>

      <Link to="/" className="flex items-center gap-2.5 text-text-primary" aria-label="funkedupshift home">
        <span className="brand-mark brand-mark-syne" aria-hidden="true">f</span>
        <span className="font-display text-[17px] font-semibold tracking-[-0.02em]">
          funked<span className="text-accent-text">up</span>shift
        </span>
      </Link>

      <button
        type="button"
        onClick={() => openLauncher({ focusSearch: true })}
        className="ml-5 flex h-[38px] min-w-0 flex-[0_1_380px] items-center gap-2 rounded-[10px] border bg-surface-1 px-3 text-left text-sm text-text-tertiary hover:bg-surface-2"
        style={{ borderColor: "var(--color-divider)" }}
        aria-label="Search apps and tools"
      >
        <MagnifyingGlass size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search apps and tools</span>
        <kbd className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-text-secondary">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setThemeState(toggleTheme())}
        aria-label="Toggle light/dark theme"
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        className="grid h-9 w-9 place-items-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
      </button>

      {signedIn ? (
        <>
          <button
            ref={avatarRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="grid h-9 w-9 place-items-center rounded-full font-sans text-sm font-semibold text-white"
            style={{
              background: "linear-gradient(135deg, rgb(var(--color-hue-violet)), rgb(var(--color-hue-coral)))",
            }}
          >
            {userInitials(user!.email)}
          </button>
          {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} returnFocusTo={avatarRef} />}
        </>
      ) : isLoading ? (
        <span className="text-xs text-text-tertiary">Loading...</span>
      ) : (
        <Link to="/auth" className="btn-primary text-sm !px-4 !py-1.5">
          Sign in
        </Link>
      )}
    </header>
  );
}

export default TopBar;
