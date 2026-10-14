import React from "react";

interface AdminPageHeaderProps {
  /** Kept for call-site readability; the title now comes from the AppPage frame (config/modules.ts). */
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * Page-specific description and actions for admin pages. The breadcrumb, icon, title and
 * "back to Admin" navigation are provided by the AppPage frame.
 */
export function AdminPageHeader({ description, actions }: AdminPageHeaderProps) {
  if (!description && !actions) return null;
  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      {description ? <p className="text-sm text-text-secondary">{description}</p> : <span />}
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
