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
 * Admin-only gate for the /lipsync routes, mirroring features/social/SocialGate.tsx
 * (redirect guests to /auth, show Access Denied for signed-in non-admins).
 * docs/lipsync-design.md gates v1 to the Cognito `admin` group, which the
 * frontend maps to the "superadmin" role (see AuthContext.mapGroupsToRole) —
 * the same check SocialGate uses for its own admin-only routes.
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

  if (!user || !hasRole(user, "superadmin")) {
    return (
      <div className="container-max section-padding text-center">
        <h1 className="text-2xl font-display font-extrabold uppercase text-text-primary mb-4">Access Denied</h1>
        <p className="text-text-secondary">You don&rsquo;t have permission to access the lipsync studio.</p>
      </div>
    );
  }

  return <Outlet />;
}
