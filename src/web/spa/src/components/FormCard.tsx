import React from "react";

/**
 * FormCard — flat surface card (1px divider border, radius 16, 14px padding) for a tool's input form.
 * Props: children, className?, plus native <form> props (onSubmit, noValidate, ...). Renders a <form>.
 * Layout inside is up to the caller (the shortener uses `flex flex-wrap gap-2.5`).
 */
export function FormCard({ children, className = "", ...rest }: React.FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      className={`rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5 ${className}`}
      {...rest}
    >
      {children}
    </form>
  );
}
