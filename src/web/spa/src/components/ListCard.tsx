import React from "react";

/**
 * ListCard — single bordered surface card whose children are separated by divider lines (.row-list).
 * Props: children, className?, plus native <div> props (e.g. aria-busy).
 * ListRow — padded row (14px 16px) to put inside a ListCard. Props: children, className?.
 * Also exports ListEmpty (centered muted empty-state message). Props: children.
 */
export function ListCard({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`row-list overflow-hidden rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ListRow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-4 py-3.5 ${className}`}>{children}</div>;
}

export function ListEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-9 text-center text-sm text-text-secondary">{children}</div>;
}
