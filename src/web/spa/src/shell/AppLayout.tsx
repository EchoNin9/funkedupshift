import React from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { Bars3Icon, ChevronDownIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Dialog } from "@headlessui/react";
import { useAuth, hasRole, canAccessSquash, canModifySquash } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import HomePage from "../features/home/HomePage";
import WebsitesPage from "../features/websites/WebsitesPage";
import SiteDetailPage from "../features/websites/SiteDetailPage";
import MediaPage from "../features/media/MediaPage";
import MediaDetailPage from "../features/media/MediaDetailPage";
import DashboardPage from "../features/dashboard/DashboardPage";
import BrandingPage from "../features/admin/BrandingPage";
import InternetDashboardAdminPage from "../features/admin/InternetDashboardAdminPage";
import MembershipPage from "../features/admin/MembershipPage";
import WebsitesAdminPage from "../features/admin/WebsitesAdminPage";
import MediaAdminPage from "../features/admin/MediaAdminPage";
import EditSitePage from "../features/admin/EditSitePage";
import EditMediaPage from "../features/admin/EditMediaPage";
import EditUserPage from "../features/admin/EditUserPage";
import AuthPage from "../features/auth/AuthPage";
import ProfilePage from "../features/profile/ProfilePage";
import SquashPage from "../features/squash/SquashPage";
import SquashAdminPage from "../features/squash/SquashAdminPage";

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
  { label: "Profile", to: "/profile", section: "discover", minRole: "user" },
  { label: "Squash", to: "/squash", section: "squash", minRole: "user" },
  { label: "Squash Admin", to: "/squash-admin", section: "squash", minRole: "manager" },
  { label: "Membership", to: "/admin/membership", section: "admin", minRole: "manager" },
  { label: "Websites", to: "/admin/websites", section: "admin", minRole: "manager" },
  { label: "Media", to: "/admin/media", section: "admin", minRole: "manager" },
  { label: "Branding", to: "/admin/branding", section: "admin", minRole: "superadmin" },
  { label: "Internet Dashboard", to: "/admin/internet-dashboard", section: "admin", minRole: "superadmin" }
];

const WINDOWSHADE_STORAGE_KEY = "funkedupshift_sectionOpen";

function getDefaultSectionState(): Record<string, boolean> {
  return {
    discover: true,
    squash: false,
    admin: false
  };
}

function loadSectionState(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(WINDOWSHADE_STORAGE_KEY);
    if (!raw) return getDefaultSectionState();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return getDefaultSectionState();
    const defaults = getDefaultSectionState();
    return { ...defaults, ...parsed };
  } catch {
    return getDefaultSectionState();
  }
}

function saveSectionState(state: Record<string, boolean>) {
  try {
    sessionStorage.setItem(WINDOWSHADE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const AppLayout: React.FC = () => {
  const { user, isLoading, signOut } = useAuth();
  const { logo } = useBranding();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [sectionOpen, setSectionOpen] = React.useState<Record<string, boolean>>(
    loadSectionState
  );

  const toggleSection = (key: string) => {
    setSectionOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSectionState(next);
      return next;
    });
  };

  const handleSignOut = () => {
    signOut();
    setMobileOpen(false);
    navigate("/");
  };

  const role = user?.role ?? "guest";

  const visibleNavItems = navItems.filter((item) => hasRole(user ?? null, item.minRole));
  const discoverItems = visibleNavItems.filter((i) => i.section === "discover");
  const squashItems = navItems
    .filter((i) => i.section === "squash")
    .filter((i) => (i.to === "/squash" ? canAccessSquash(user) : canModifySquash(user)));
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
                  className="h-8 w-auto rounded-md border border-slate-700 object-contain"
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
                  onClick={handleSignOut}
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
              <button
                type="button"
                onClick={() => toggleSection("discover")}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-slate-500 uppercase mb-2 hover:bg-slate-800/70 hover:text-slate-300"
              >
                Discover
                {(sectionOpen["discover"] ?? true) ? (
                  <ChevronDownIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4 shrink-0" />
                )}
              </button>
              {(sectionOpen["discover"] ?? true) && (
                <div className="space-y-1">
                  {discoverItems.map((item) => (
                    <NavLink key={item.to} to={item.to} className={navLinkClass}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>

            {squashItems.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => toggleSection("squash")}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-slate-500 uppercase mb-2 hover:bg-slate-800/70 hover:text-slate-300"
                >
                  Squash
                  {(sectionOpen["squash"] ?? false) ? (
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 shrink-0" />
                  )}
                </button>
                {(sectionOpen["squash"] ?? false) && (
                  <div className="space-y-1">
                    {squashItems.map((item) => (
                      <NavLink key={item.to} to={item.to} className={navLinkClass}>
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )}

            {adminItems.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => toggleSection("admin")}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-slate-500 uppercase mb-2 hover:bg-slate-800/70 hover:text-slate-300"
                >
                  Admin
                  {(sectionOpen["admin"] ?? false) ? (
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 shrink-0" />
                  )}
                </button>
                {(sectionOpen["admin"] ?? false) && (
                  <div className="space-y-1">
                    {adminItems.map((item) => (
                      <NavLink key={item.to} to={item.to} className={navLinkClass}>
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
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
                <button
                  type="button"
                  onClick={() => toggleSection("discover")}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-slate-500 uppercase mb-2 hover:bg-slate-800/70 hover:text-slate-300"
                >
                  Discover
                  {(sectionOpen["discover"] ?? true) ? (
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 shrink-0" />
                  )}
                </button>
                {(sectionOpen["discover"] ?? true) && (
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
                )}
              </div>

              {squashItems.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection("squash")}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-slate-500 uppercase mb-2 hover:bg-slate-800/70 hover:text-slate-300"
                  >
                    Squash
                    {(sectionOpen["squash"] ?? false) ? (
                      <ChevronDownIcon className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {(sectionOpen["squash"] ?? false) && (
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
                  )}
                </div>
              )}

              {adminItems.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection("admin")}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-slate-500 uppercase mb-2 hover:bg-slate-800/70 hover:text-slate-300"
                  >
                    Admin
                    {(sectionOpen["admin"] ?? false) ? (
                      <ChevronDownIcon className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {(sectionOpen["admin"] ?? false) && (
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
                  )}
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
              <Route path="/websites/:id" element={<SiteDetailPage />} />
              <Route path="/media" element={<MediaPage />} />
              <Route path="/media/:id" element={<MediaDetailPage />} />
              <Route path="/internet-dashboard" element={<DashboardPage />} />
              <Route path="/squash" element={<SquashPage />} />
              <Route path="/squash-admin" element={<SquashAdminPage />} />
              <Route path="/admin/branding" element={<BrandingPage />} />
              <Route path="/admin/internet-dashboard" element={<InternetDashboardAdminPage />} />
              <Route path="/admin/membership" element={<MembershipPage />} />
              <Route path="/admin/users/edit" element={<EditUserPage />} />
              <Route path="/admin/websites" element={<WebsitesAdminPage />} />
              <Route path="/admin/sites/edit/:id" element={<EditSitePage />} />
              <Route path="/admin/media" element={<MediaAdminPage />} />
              <Route path="/admin/media/edit/:id" element={<EditMediaPage />} />
              <Route path="/admin/*" element={<div>Admin area</div>} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/auth" element={<AuthPage />} />
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
            {user && (
              <Link to="/profile" className="hover:text-slate-300">
                Profile
              </Link>
            )}
            {hasRole(user ?? null, "superadmin") && (
              <Link to="/admin/branding" className="hover:text-slate-300">
                Branding
              </Link>
            )}
            {canAccessSquash(user) && (
              <Link to="/squash" className="hover:text-slate-300">
                Squash
              </Link>
            )}
            {canModifySquash(user) && (
              <Link to="/squash-admin" className="hover:text-slate-300">
                Squash Admin
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

