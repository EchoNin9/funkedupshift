import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Moon, Sun } from "@phosphor-icons/react";
import { getTheme, toggleTheme, type Theme } from "./theme";

/** Mobile (≤640px) top bar (README §8): just the wordmark and the theme toggle. Search, apps and account live in the TabBar. */
export function MobileTopBar() {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  return (
    <header
      className="only-narrow sticky top-0 z-30 h-[52px] items-center justify-between gap-3 border-b px-4 backdrop-blur-[14px]"
      style={{
        background: "color-mix(in srgb, var(--color-bg) 84%, transparent)",
        borderColor: "var(--color-divider)",
        boxSizing: "content-box",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <Link to="/" className="flex min-w-0 items-center gap-2.5 text-text-primary" aria-label="funkedupshift home">
        <span className="brand-mark brand-mark-syne" aria-hidden="true">f</span>
        <span className="truncate font-display text-[17px] font-semibold tracking-[-0.02em]">
          funked<span className="text-accent-text">up</span>shift
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setThemeState(toggleTheme())}
        aria-label="Toggle light/dark theme"
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        {theme === "dark" ? <Sun size={21} /> : <Moon size={21} />}
      </button>
    </header>
  );
}

export default MobileTopBar;
