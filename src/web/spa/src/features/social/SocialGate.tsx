import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth, hasRole } from "../../shell/AuthContext";

function PageLoader() {
  return (
    <div className="container-max section-padding flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Admin-only gate for the /social routes, mirroring shell/AdminLayout.tsx's
 * pattern (redirect guests to /auth, show Access Denied for signed-in
 * non-admins). Social scheduling isn't nested under /admin in the URL, so it
 * can't reuse AdminLayout directly — this reproduces the same gate keyed on
 * hasRole(user, "superadmin"), the same check InternetDashboardAdminPage.tsx
 * uses inline for its superadmin-only actions.
 */
export function SocialGate() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) navigate("/auth");
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user || !hasRole(user, "superadmin")) {
    return (
      <div className="container-max section-padding text-center">
        <h1 className="text-2xl font-display font-extrabold uppercase text-text-primary mb-4">Access Denied</h1>
        <p className="text-text-secondary">You don&rsquo;t have permission to access social scheduling.</p>
      </div>
    );
  }

  return <Outlet />;
}
