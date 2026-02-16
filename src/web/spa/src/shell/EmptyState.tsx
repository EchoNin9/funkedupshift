import React from "react";
import { Link } from "react-router-dom";
import { useAuth, hasRole } from "./AuthContext";

export type UserRole = "guest" | "user" | "manager" | "superadmin";

interface EmptyStateProps {
  /** Large icon SVG path(s) — rendered in a 24×24 viewBox */
  iconPath: string;
  /** Heading text */
  title: string;
  /** Description shown to public visitors */
  description: string;
  /** Admin page link (e.g. /admin/websites) */
  adminLink?: string;
  /** Label for the admin CTA button */
  adminLabel?: string;
  /** Minimum role to see admin CTA. Default: manager */
  minRoleForAdmin?: UserRole;
}

/**
 * Full-width, visually prominent empty state.
 * Renders admin CTA when the current user meets minRoleForAdmin.
 */
export function EmptyState({
  iconPath,
  title,
  description,
  adminLink,
  adminLabel = "Add Content",
  minRoleForAdmin = "manager",
}: EmptyStateProps) {
  const { user } = useAuth();
  const canEdit = hasRole(user ?? null, minRoleForAdmin);

  return (
    <div className="text-center py-20 sm:py-28">
      {/* Icon */}
      <div className="mx-auto w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 flex items-center justify-center mb-8">
        <svg
          className="w-12 h-12 text-primary-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d={iconPath}
          />
        </svg>
      </div>

      {/* Text */}
      <h2 className="text-2xl sm:text-3xl font-display font-bold text-secondary-100 mb-3">
        {title}
      </h2>
      <p className="text-secondary-400 text-lg max-w-md mx-auto mb-8">
        {description}
      </p>

      {/* CTA for managers / admins */}
      {canEdit && adminLink && (
        <Link to={adminLink} className="btn-primary">
          {adminLabel}
        </Link>
      )}

      {/* Decorative dots */}
      <div className="flex justify-center gap-1.5 mt-12">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-2 h-2 rounded-full bg-primary-500/30 animate-pulse-slow" />
        ))}
      </div>
    </div>
  );
}
