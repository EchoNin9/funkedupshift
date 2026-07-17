import React from "react";

interface PagerProps {
  /** 1-indexed current page. */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  className?: string;
}

/* Prev/next + "page X of Y" — hides itself entirely when there's nothing to page through. */
export const Pager: React.FC<PagerProps> = ({ page, pageCount, onChange, className = "" }) => {
  if (pageCount <= 1) return null;

  return (
    <nav
      className={`flex items-center justify-center gap-4 pt-2 ${className}`}
      aria-label="Pagination"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
      >
        ← Prev
      </button>
      <span className="font-display text-xs font-extrabold uppercase tracking-tight text-text-secondary">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
        className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
      >
        Next →
      </button>
    </nav>
  );
};
