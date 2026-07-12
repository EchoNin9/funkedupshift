import React from "react";

/** Small badge marking read-only Era.app data. */
const EraBadge: React.FC = () => (
  <span className="rounded-full border border-accent-500 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent-500">
    Era
  </span>
);

/** Quiet empty state shown when no Era key is configured. */
export const EraEmptyState: React.FC = () => (
  <p className="rounded-md border border-border-subtle bg-surface-1 px-4 py-2 text-xs text-text-tertiary">
    Connect Era (era.app) to sync accounts automatically — add ERA_API_KEY to enable.
  </p>
);

export default EraBadge;
