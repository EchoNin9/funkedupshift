import React from "react";

const styles = {
  error: "border-danger/60 bg-danger/10 text-danger",
  success: "border-success/60 bg-success/10 text-success",
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
