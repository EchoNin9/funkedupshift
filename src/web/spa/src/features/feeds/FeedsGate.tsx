import React, { useEffect } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { LockSimple } from "@phosphor-icons/react";
import { buttonClasses } from "../../components/buttonClasses";
import { useAuth } from "../../shell/AuthContext";

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent motion-safe:animate-spin" />
    </div>
  );
}

/**
 * Auth-only gate for /feeds routes — any authenticated Cognito user is
 * allowed; guests see a sign-in prompt and are redirected to /auth.
 */
export function FeedsGate() {
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
      <div className="space-y-4">
        <h1 className="sr-only">Feeds</h1>
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to access your feeds</div>
            <div className="text-sm text-text-secondary">
              Your subscriptions, starred items, and push archive keys stay private to your account.
            </div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

export default FeedsGate;
