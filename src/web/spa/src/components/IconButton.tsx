import React from "react";
import { focusRing } from "./buttonClasses";

/**
 * IconButton — square 36px icon-only button.
 * Props: icon: ReactNode (e.g. <Trash size={16} />), label: string (REQUIRED; used as aria-label + title),
 *        tone?: "default" | "danger", plus any native <button> props (onClick, disabled, ...).
 */
interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title" | "aria-label"> {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "danger";
}

export function IconButton({ icon, label, tone = "default", className = "", type = "button", ...rest }: IconButtonProps) {
  const color = tone === "danger" ? "text-danger" : "text-text-primary";
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-md border border-border-default bg-surface-3 ${color} hover:border-border-hover motion-safe:transition-colors motion-safe:duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${focusRing} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
}
