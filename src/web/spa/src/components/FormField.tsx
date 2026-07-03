import React from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ label, required, htmlFor, children, className = "" }: FormFieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block font-display font-extrabold uppercase tracking-tight text-xs text-text-primary mb-1.5">
        {label}{required && <span className="text-accent ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
