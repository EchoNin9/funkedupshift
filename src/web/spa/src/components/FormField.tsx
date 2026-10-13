import React, { useId } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

const CONTROLS = ["input", "select", "textarea"];

export function FormField({ label, required, htmlFor, children, className = "" }: FormFieldProps) {
  const autoId = useId();
  // Associate the label with a direct input/select/textarea child so it is announced by screen readers.
  let id = htmlFor;
  let content = children;
  if (!id && React.isValidElement(children) && typeof children.type === "string" && CONTROLS.includes(children.type)) {
    const existing = (children.props as { id?: string }).id;
    id = existing ?? autoId;
    if (!existing) content = React.cloneElement(children as React.ReactElement<{ id?: string }>, { id });
  }
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-display font-extrabold uppercase tracking-tight text-xs text-text-primary mb-1.5">
        {label}{required && <span className="text-accent-text ml-0.5">*</span>}
      </label>
      {content}
    </div>
  );
}
