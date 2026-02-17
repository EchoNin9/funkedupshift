import React, { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { getVisibleAdminModules } from "../config/modules";

function PageLoader() {
  return (
    <div className="container-max section-padding flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function AdminLayout() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const adminModules = getVisibleAdminModules(user);

  useEffect(() => {
    if (!isLoading && !user) navigate("/auth");
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user || adminModules.length === 0) {
    return (
      <div className="container-max section-padding text-center">
        <h1 className="text-2xl font-display font-bold text-secondary-100 mb-4">Access Denied</h1>
        <p className="text-secondary-400">You don&rsquo;t have permission to access the admin area.</p>
      </div>
    );
  }

  return (
    <div className="py-6">
      <Outlet />
    </div>
  );
}
