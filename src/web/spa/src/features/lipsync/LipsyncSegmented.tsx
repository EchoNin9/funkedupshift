import React from "react";
import { focusRing } from "../../components/buttonClasses";

/**
 * LipsyncSegmented — pill-style single-choice toggle (buttons with aria-pressed).
 * Props: label: string (aria-label of the group), value: T, onChange(value: T),
 *        options: { value: T; label: string; icon?: ReactNode }[].
 * Each segment is >=40px tall; the selected one is filled with the accent.
 */
interface Option<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function LipsyncSegmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-ds-md border border-border-default bg-surface-0 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`inline-flex min-h-10 items-center gap-2 rounded-ds-sm px-4 text-sm font-semibold motion-safe:transition-colors motion-safe:duration-150 ${focusRing} ${
            value === o.value
              ? "bg-accent text-on-accent"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
