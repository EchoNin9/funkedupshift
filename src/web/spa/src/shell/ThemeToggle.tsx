import React, { useState } from "react";
import { SunIcon, MoonIcon } from "@heroicons/react/24/outline";
import { getTheme, toggleTheme, type Theme } from "./theme";

/** Dark/light toggle button. Reflects current theme; persists via theme.ts. (FUNK-3) */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  return (
    <button
      type="button"
      onClick={() => setThemeState(toggleTheme())}
      aria-label="Toggle light/dark theme"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full border-2 border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors duration-150 ${className}`}
    >
      {theme === "dark" ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
    </button>
  );
}

export default ThemeToggle;
