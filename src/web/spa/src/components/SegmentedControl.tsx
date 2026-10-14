import React from "react";
import { focusRing } from "./buttonClasses";

/**
 * SegmentedControl — pill-group switcher for a small set of mutually exclusive views/options.
 * Props: options: { id: T; label: string }[], value: T, onChange(id: T), ariaLabel: string (names the group),
 *        size?: "md" | "sm" = "md" (md = 44px touch targets, sm = 36px), className?: string.
 * Renders buttons with aria-pressed inside a role="group"; wraps on narrow screens. Does not render panels.
 */
interface SegmentedControlProps<T extends string> {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  size?: "md" | "sm";
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className = "",
}: SegmentedControlProps<T>) {
  const h = size === "md" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-[13px]";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full flex-wrap gap-1 rounded-ds-lg border border-divider bg-surface-2 p-1 ${className}`}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`inline-flex items-center justify-center rounded-ds-md font-semibold motion-safe:transition-colors motion-safe:duration-150 ${h} ${focusRing} ${
              active
                ? "bg-accent text-on-accent"
                : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
