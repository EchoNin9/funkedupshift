import React from "react";

/**
 * IconButton — square 36px icon-only button (.btn .btn-secondary .btn-icon).
 * Props: icon: ReactNode (e.g. <Trash size={16} />), label: string (REQUIRED; used as aria-label + title),
 *        tone?: "default" | "danger", plus any native <button> props (onClick, disabled, ...).
 */
interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title" | "aria-label"> {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "danger";
}

export function IconButton({ icon, label, tone = "default", className = "", type = "button", ...rest }: IconButtonProps) {
  const color = tone === "danger" ? " text-danger" : "";
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`btn btn-secondary btn-icon${color}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {icon}
    </button>
  );
}
