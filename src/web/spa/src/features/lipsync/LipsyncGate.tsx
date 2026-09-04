import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../shell/AuthContext";

function PageLoader() {
  return (
    <div className="container-max section-padding flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Auth-only gate for the /lipsync routes -- any signed-in user, no role
 * check. v1 gated this to the Cognito `admin` group (frontend "superadmin"
 * role); docs/lipsync-design.md's API contract update opened the job routes
 * to any authenticated user while keeping `/lipsync/admin/*` (budgets)
 * admin-only, so this gate now only needs to keep guests out, same as
 * shell/AdminLayout.tsx's redirect-to-/auth pattern. The admin-only budgets
 * view lives at its own route/gate (see features/lipsync/LipsyncBudgetsPage.tsx),
 * not here.
 */
export function LipsyncGate() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) navigate("/auth");
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    return (
      <div className="container-max section-padding text-center">
        <h1 className="text-2xl font-display font-extrabold uppercase text-text-primary mb-4">Access Denied</h1>
        <p className="text-text-secondary">Sign in to access the lipsync studio.</p>
      </div>
    );
  }

  return <Outlet />;
}
