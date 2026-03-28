import React from "react";

interface BadgeProps {
  label: string;
  onRemove?: () => void;
  className?: string;
}

export function Badge({ label, onRemove, className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200 ${className}`}>
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:text-red-400">
          ×
        </button>
      )}
    </span>
  );
}
