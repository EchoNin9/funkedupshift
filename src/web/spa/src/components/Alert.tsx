import React from "react";

const styles = {
  error: "border-red-500/60 bg-red-500/10 text-red-200",
  success: "border-emerald-500/60 bg-emerald-500/10 text-emerald-200",
};

interface AlertProps {
  variant: "error" | "success";
  children: React.ReactNode;
  className?: string;
}

export function Alert({ variant, children, className = "" }: AlertProps) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles[variant]} ${className}`}>
      {children}
    </div>
  );
}
