import React from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { toggleTheme, useThemeState } from "./theme";

/** Dark/light toggle button. Reflects the current mode (kept in sync with the account menu); persists via theme.ts. (FUNK-3) */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode: theme } = useThemeState();
  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label="Toggle light/dark theme"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full border-2 border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors duration-150 ${className}`}
    >
      {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}

export default ThemeToggle;
