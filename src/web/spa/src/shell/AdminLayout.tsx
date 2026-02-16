import React, { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Bars3Icon } from "@heroicons/react/24/outline";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const sidebarContent = (
    <nav className="flex flex-col gap-1 py-4">
      <Link
        to="/admin"
        className="mb-2 px-4 py-2 text-sm font-semibold text-slate-400 hover:text-primary-400 transition-colors"
      >
        Admin Home
      </Link>
      {adminModules.map((mod) => (
        <NavLink
          key={mod.path}
          to={mod.path}
          onClick={() => setSidebarOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 text-sm rounded-r-md transition-colors ${
              isActive
                ? "bg-slate-800 text-primary-400 font-medium border-l-2 border-primary-500 -ml-px"
                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
            }`
          }
        >
          <mod.icon className="w-5 h-5 shrink-0" />
          {mod.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Desktop sidebar - fixed below header (header ~56px) */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:fixed md:top-14 md:bottom-0 md:left-0 md:z-40 border-r border-slate-800 bg-slate-950">
        <div className="flex-1 overflow-y-auto">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm md:hidden"
            aria-hidden
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="fixed top-14 bottom-0 left-0 z-50 w-64 bg-slate-950 border-r border-slate-800 md:hidden overflow-y-auto"
            aria-label="Admin navigation"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:pl-56">
        {/* Mobile admin menu bar */}
        <div className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-950/95">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Open admin menu"
          >
            <Bars3Icon className="w-6 h-6" />
          </button>
          <span className="text-sm font-medium text-slate-400">Admin</span>
        </div>
        <div className="py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
