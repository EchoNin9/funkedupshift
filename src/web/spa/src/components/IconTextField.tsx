import React from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { focusRing } from "./buttonClasses";

/**
 * IconTextField — 48px text input with a leading icon. Forwards ref + native <input> props.
 * Props: icon: ReactNode (e.g. <LinkSimple size={18} />), invalid?: boolean (sets aria-invalid + danger border),
 *        wrapperClassName?: string (for flex sizing, e.g. "flex-1 basis-[320px]"). Always pass aria-label or a <label>.
 * FieldError — inline 13px/600 danger message with WarningCircle. Props: id (match aria-describedby), children.
 *        Renders nothing when children is falsy; role="alert" so it is announced.
 */
interface IconTextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: React.ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
}

export const IconTextField = React.forwardRef<HTMLInputElement, IconTextFieldProps>(function IconTextField(
  { icon, invalid = false, wrapperClassName = "", className = "", ...rest },
  ref
) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true">
        {icon}
      </span>
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`min-h-12 w-full rounded-ds-md border bg-surface-0 pl-[42px] pr-3 text-[15px] text-text-primary placeholder:text-text-tertiary motion-safe:transition-colors motion-safe:duration-150 disabled:opacity-60 ${
          invalid ? "border-danger" : "border-border-default hover:border-border-hover"
        } ${focusRing} ${className}`}
        {...rest}
      />
    </div>
  );
});

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mx-0.5 mt-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
      <WarningCircle size={16} weight="regular" aria-hidden="true" className="shrink-0" />
      {children}
    </p>
  );
}
