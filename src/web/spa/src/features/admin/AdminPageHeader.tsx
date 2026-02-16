import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * Consistent header for admin pages: Back to Admin link, title, optional description and actions.
 */
export function AdminPageHeader({ title, description, actions }: AdminPageHeaderProps) {
  return (
    <header className="space-y-4">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-primary-400 transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Admin
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-50 tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
