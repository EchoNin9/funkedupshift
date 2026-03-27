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
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-200 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
