import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../shell/AuthContext";
import { getVisibleAdminModules } from "../../config/modules";

export function AdminDashboard() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const visibleModules = getVisibleAdminModules(user);

  useEffect(() => {
    if (!isLoading && !user) navigate("/auth");
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="container-max section-padding text-center">
        <div className="inline-block w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || visibleModules.length === 0) {
    return (
      <div className="container-max section-padding text-center">
        <h1 className="text-2xl font-display font-bold text-secondary-100 mb-4">
          Access Denied
        </h1>
        <p className="text-secondary-400">
          You don&rsquo;t have permission to access the admin area.
        </p>
      </div>
    );
  }

  return (
    <main className="container-max section-padding">
      <h1 className="text-4xl sm:text-5xl font-display font-bold text-gradient mb-10">
        Admin
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleModules.map((mod) => (
          <Link
            key={mod.path}
            to={mod.path}
            className="card block p-6 hover:border-primary-500/50 transition-colors group"
          >
            <mod.icon className="w-8 h-8 text-primary-500 mb-4 group-hover:scale-110 transition-transform" />
            <h2 className="text-lg font-display font-bold text-secondary-100 mb-1">
              {mod.label}
            </h2>
            <p className="text-sm text-secondary-400">{mod.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
