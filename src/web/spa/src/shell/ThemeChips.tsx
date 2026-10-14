import React from "react";
import { themeVars, type ThemeMode, type ThemeRecord } from "./theme";

/** Inline custom properties that render a subtree in the given theme + mode (independent of the page theme). */
export function scopedVars(theme: ThemeRecord, mode: ThemeMode): React.CSSProperties {
  return themeVars(theme, mode) as unknown as React.CSSProperties;
}

interface ThemeChipProps {
  theme: ThemeRecord;
  mode: ThemeMode;
  selected: boolean;
  onSelect: () => void;
  /** menu context uses menuitemradio, plain pages use radio */
  role?: "radio" | "menuitemradio";
}

/** Theme swatch: accent + two hue dots, rendered in that theme. Selected = 2px accent ring. */
export function ThemeChip({ theme, mode, selected, onSelect, role = "radio" }: ThemeChipProps) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onSelect}
      title={theme.name}
      style={{
        ...scopedVars(theme, mode),
        background: "rgb(var(--color-surface-3))",
        color: "rgb(var(--color-text-primary))",
        boxShadow: selected ? "0 0 0 2px rgb(var(--color-accent))" : "0 0 0 1px var(--color-divider)",
      }}
      className="flex min-h-[40px] min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--color-accent))]"
    >
      <span className="flex shrink-0 gap-1" aria-hidden="true">
        <span className="h-3 w-3 rounded-full" style={{ background: "rgb(var(--color-accent))" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "rgb(var(--color-hue-teal))" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "rgb(var(--color-hue-coral))" }} />
      </span>
      <span className="min-w-0 flex-1 truncate">{theme.name}</span>
    </button>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  role?: "radio" | "menuitemradio";
}

/** Two-up segmented control (Dark / Light). */
export function Segmented<T extends string>({ value, options, onChange, label, role = "radio" }: SegmentedProps<T>) {
  return (
    <div role={role === "radio" ? "radiogroup" : "group"} aria-label={label} className="flex gap-1 rounded-lg bg-surface-3 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={role}
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-semibold transition-colors ${
              on ? "bg-surface-2 text-text-primary shadow-ds-sm" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Mini preview of a theme in one mode: brand mark, four hue tiles, a button and a link. */
export function ThemePreview({ theme, mode }: { theme: ThemeRecord; mode: ThemeMode }) {
  const tile = (v: string) => (
    <span
      className="h-5 flex-1 rounded"
      style={{ background: `color-mix(in srgb, rgb(var(${v})) 17%, transparent)`, boxShadow: `inset 0 0 0 1px rgb(var(${v}) / .45)` }}
    >
      <span className="m-1.5 block h-2 w-2 rounded-full" style={{ background: `rgb(var(${v}))` }} />
    </span>
  );
  return (
    <div
      style={{ ...scopedVars(theme, mode), background: "rgb(var(--color-surface-0))", color: "rgb(var(--color-text-primary))", boxShadow: "0 0 0 1px var(--color-divider)" }}
      className="min-w-0 rounded-lg p-2.5"
      aria-label={`${theme.name} ${mode} preview`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="grid h-5 w-5 place-items-center rounded-md text-[11px] font-extrabold text-white" style={{ background: "var(--color-brand)", fontFamily: "var(--font-brand)" }}>f</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgb(var(--color-text-secondary))" }}>{mode}</span>
      </div>
      <div className="mb-2 flex gap-1">
        {tile("--color-hue-teal")}
        {tile("--color-hue-violet")}
        {tile("--color-hue-coral")}
        {tile("--color-hue-amber")}
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md px-2 py-1 text-[11px] font-bold" style={{ background: "rgb(var(--color-accent))", color: "rgb(var(--color-on-accent))" }}>Button</span>
        <span className="text-[11px] font-semibold underline" style={{ color: "rgb(var(--color-accent-text))" }}>Link</span>
      </div>
    </div>
  );
}
