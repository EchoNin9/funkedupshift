import React from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { Dialog } from "@headlessui/react";
import { useAuth, hasRole } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import HomePage from "../features/home/HomePage";
import WebsitesPage from "../features/websites/WebsitesPage";
import MediaPage from "../features/media/MediaPage";
import DashboardPage from "../features/dashboard/DashboardPage";
import BrandingPage from "../features/admin/BrandingPage";

interface NavItem {
  label: string;
  to: string;
  section: "discover" | "squash" | "admin";
  minRole: "guest" | "user" | "manager" | "superadmin";
}

const navItems: NavItem[] = [
  { label: "Websites", to: "/websites", section: "discover", minRole: "guest" },
  { label: "Media", to: "/media", section: "discover", minRole: "guest" },
  { label: "Internet Dashboard", to: "/internet-dashboard", section: "discover", minRole: "guest" },
  { label: "Squash", to: "/squash", section: "squash", minRole: "user" },
  { label: "Squash Admin", to: "/squash-admin", section: "squash", minRole: "manager" },
  { label: "Add Site", to: "/admin/sites/add", section: "admin", minRole: "superadmin" },
  { label: "Add Media", to: "/admin/media/add", section: "admin", minRole: "superadmin" },
  { label: "Categories", to: "/admin/categories", section: "admin", minRole: "superadmin" },
  { label: "Media Categories", to: "/admin/media-categories", section: "admin", minRole: "superadmin" },
  { label: "Users", to: "/admin/users", section: "admin", minRole: "superadmin" },
  { label: "Groups", to: "/admin/groups", section: "admin", minRole: "superadmin" },
  { label: "Branding", to: "/admin/branding", section: "admin", minRole: "superadmin" }
];

const AppLayout: React.FC = () => {
  const { user, isLoading, signOut } = useAuth();
  const { logo } = useBranding();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const role = user?.role ?? "guest";

  const visibleNavItems = navItems.filter((item) => hasRole(user ?? null, item.minRole));
  const discoverItems = visibleNavItems.filter((i) => i.section === "discover");
  const squashItems = visibleNavItems.filter((i) => i.section === "squash");
  const adminItems = visibleNavItems.filter((i) => i.section === "admin");

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "flex items-center rounded-md px-3 py-2 text-sm font-medium",
      isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
    ].join(" ");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur z-20 sticky top-0">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-2 text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open main navigation"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
            <Link to="/" className="flex items-center gap-2">
              {logo ? (
                <img
                  src={logo.url}
                  alt={logo.alt}
                  className="h-8 w-8 rounded-md border border-slate-700 object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-md border border-slate-700 bg-gradient-to-br from-brand-orange to-brand-navy" />
              )}
              <span className="text-sm font-semibold tracking-[0.2em] uppercase text-slate-100">
                Funked Up Shift
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="hidden sm:inline text-xs text-slate-300">
                  {user.email}{" "}
                  <span className="text-slate-500">
                    ({user.role === "superadmin" ? "SuperAdmin" : user.role})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                >
                  Sign out
                </button>
              </>
            ) : isLoading ? (
              <span className="text-xs text-slate-400">Loading...</span>
            ) : (
              <Link
                to="/auth"
                className="rounded-full bg-brand-orange px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-orange-500"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-64 border-r border-slate-800 bg-slate-950/80">
          <nav className="h-full overflow-y-auto px-4 py-6 space-y-6 text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Discover</p>
              <div className="space-y-1">
                {discoverItems.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            {squashItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Squash</p>
                <div className="space-y-1">
                  {squashItems.map((item) => (
                    <NavLink key={item.to} to={item.to} className={navLinkClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            )}

            {adminItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Admin</p>
                <div className="space-y-1">
                  {adminItems.map((item) => (
                    <NavLink key={item.to} to={item.to} className={navLinkClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            )}
          </nav>
        </aside>

        {/* Mobile sidebar */}
        <Dialog open={mobileOpen} onClose={setMobileOpen} className="lg:hidden">
          <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
          <Dialog.Panel className="fixed inset-y-0 left-0 w-72 bg-slate-950 border-r border-slate-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-sm font-semibold tracking-[0.15em] uppercase text-slate-100">
                Funked Up Shift
              </Dialog.Title>
              <button
                type="button"
                className="rounded-md p-1 text-slate-200 hover:bg-slate-800"
                onClick={() => setMobileOpen(false)}
                aria-label="Close main navigation"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto space-y-6 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Discover</p>
                <div className="space-y-1">
                  {discoverItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={navLinkClass}
                      onClick={() => setMobileOpen(false)}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>

              {squashItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Squash</p>
                  <div className="space-y-1">
                    {squashItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={navLinkClass}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              )}

              {adminItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Admin</p>
                  <div className="space-y-1">
                    {adminItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={navLinkClass}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              )}
            </nav>
          </Dialog.Panel>
        </Dialog>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-6xl px-4 py-6">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/websites" element={<WebsitesPage />} />
              <Route path="/media" element={<MediaPage />} />
              <Route path="/internet-dashboard" element={<DashboardPage />} />
              {/* Placeholders for not-yet-migrated modules */}
              <Route path="/squash" element={<div>Squash module (coming soon)</div>} />
              <Route path="/squash-admin" element={<div>Squash admin (coming soon)</div>} />
              <Route path="/admin/branding" element={<BrandingPage />} />
              <Route path="/admin/*" element={<div>Admin area (coming soon)</div>} />
              <Route path="/auth" element={<div>Auth flows (coming soon)</div>} />
              <Route path="*" element={<div>Not found</div>} />
            </Routes>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <nav className="flex flex-wrap gap-3 justify-center sm:justify-start">
            <Link to="/" className="hover:text-slate-300">
              Home
            </Link>
            <Link to="/websites" className="hover:text-slate-300">
              Websites
            </Link>
            <Link to="/media" className="hover:text-slate-300">
              Media
            </Link>
            <Link to="/internet-dashboard" className="hover:text-slate-300">
              Internet dashboard
            </Link>
            {hasRole(user ?? null, "superadmin") && (
              <Link to="/admin/branding" className="hover:text-slate-300">
                Branding
              </Link>
            )}
          </nav>
          <div className="text-slate-600">
            <span className="font-mono text-[11px]">funkedupshift</span>{" "}
            <span className="text-slate-700">·</span> <span>All data public, admin-managed curation</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;

