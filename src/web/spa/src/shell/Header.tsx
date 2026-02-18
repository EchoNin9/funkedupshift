import React, { useState, useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bars3Icon, ChevronDownIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import {
  getPublicModulesBySection,
  getVisibleAdminModules,
  getAdminHomeModules,
  getVisibleModuleGroups,
} from "../config/modules";
import type { PublicModule } from "../config/modules";
import ImpersonationBanner from "./ImpersonationBanner";
import ImpersonationSelector from "./ImpersonationSelector";

const HOVER_CLOSE_DELAY_MS = 180;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `transition-colors duration-200 ${isActive ? "text-primary-400 font-semibold" : "text-slate-300 hover:text-white"}`;

function HoverDropdown({
  items,
  label,
}: {
  items: PublicModule[];
  label: string;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = items.some(
    (m) => location.pathname === m.path || location.pathname.startsWith(m.path + "/")
  );

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearCloseTimeout();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => () => clearCloseTimeout(), []);

  if (items.length === 0) return null;
  if (items.length === 1) {
    return (
      <NavLink to={items[0].path} className={`flex items-center gap-1 text-sm font-medium ${navLinkClass({ isActive })}`}>
        {items[0].label}
      </NavLink>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className={`flex items-center gap-1 text-sm font-medium outline-none ${navLinkClass({ isActive })}`}
      >
        {label}
        <ChevronDownIcon className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl z-50">
          {items.map((m) => (
            <NavLink
              key={m.path}
              to={m.path}
              className={({ isActive: a }) =>
                `block px-4 py-2 text-sm transition-colors ${
                  a ? "bg-slate-800 text-primary-400 font-medium" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              {m.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { user, isLoading, signOut } = useAuth();
  const { logo, siteName } = useBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const location = useLocation();

  const bySection = getPublicModulesBySection(user);
  const discoverIds = ["websites", "media", "memes", "internet-dashboard"] as const;
  const allForDiscover = [...(bySection.discover ?? []), ...(bySection.memes ?? [])];
  const discoverItems = discoverIds
    .map((id) => allForDiscover.find((m) => m.id === id))
    .filter((m): m is PublicModule => m != null);
  const recommendedItems = bySection.recommended ?? [];
  const adminItems = getVisibleAdminModules(user);
  const showAdminLink = adminItems.length > 0;
  const adminHomeModules = getAdminHomeModules(user);
  const moduleGroups = getVisibleModuleGroups(user);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mobileOpen]);

  const handleSignOut = () => {
    signOut();
    setMobileOpen(false);
  };

  return (
    <header
      ref={headerRef}
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-slate-950/95 backdrop-blur-sm shadow-lg" : "bg-slate-950"
      }`}
    >
      <ImpersonationBanner />

      {/* Main nav */}
      <nav className="container-max flex items-center justify-between py-3">
        {/* Logo + brand */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          {logo ? (
            <img
              src={logo.url}
              alt={logo.alt}
              className="h-8 w-auto rounded-md border border-slate-700 object-contain"
            />
          ) : (
            <div className="h-8 w-8 rounded-md border border-slate-700 bg-gradient-to-br from-brand-orange to-brand-navy" />
          )}
          <span className="text-sm font-semibold tracking-[0.2em] uppercase text-slate-100 hidden sm:inline">
            {siteName}
          </span>
        </Link>

        {/* Desktop nav - Discover, Recommended, Admin only */}
        <div className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium">
          <HoverDropdown items={discoverItems} label="Discover" />
          <HoverDropdown items={recommendedItems} label="Recommended" />
          {showAdminLink && (
            <NavLink to="/admin" className={navLinkClass}>
              Admin
            </NavLink>
          )}
          {user ? (
            <div className="flex items-center gap-3 ml-2 pl-4 border-l border-slate-700">
              <ImpersonationSelector />
              <span className="text-xs text-slate-400 hidden lg:inline truncate max-w-[140px]">
                {user.email}
              </span>
              <NavLink to="/profile" className={navLinkClass}>
                Profile
              </NavLink>
              <button
                onClick={handleSignOut}
                className="text-slate-400 hover:text-red-400 transition-colors text-xs font-medium"
              >
                Sign out
              </button>
            </div>
          ) : isLoading ? (
            <span className="text-xs text-slate-500">Loading...</span>
          ) : (
            <Link
              to="/auth"
              className="btn-primary text-xs !px-4 !py-1.5 ml-2"
            >
              Sign in
            </Link>
          )}
        </div>

        {/* Mobile hamburger - min 44px touch target */}
        <div className="flex md:hidden items-center gap-2">
          {user && <ImpersonationSelector />}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-300 hover:text-white rounded-md hover:bg-slate-800"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile menu - single hamburger with top nav + sidebar items (see plan section 5) */}
      {mobileOpen && (
        <MobileNavMenu
          discoverItems={discoverItems}
          recommendedItems={recommendedItems}
          showAdminLink={showAdminLink}
          adminHomeModules={adminHomeModules}
          moduleGroups={moduleGroups}
          user={user}
          isLoading={isLoading}
          onSignOut={handleSignOut}
          onClose={() => setMobileOpen(false)}
        />
      )}
    </header>
  );
}

interface MobileNavMenuProps {
  discoverItems: PublicModule[];
  recommendedItems: PublicModule[];
  showAdminLink: boolean;
  adminHomeModules: ReturnType<typeof getAdminHomeModules>;
  moduleGroups: ReturnType<typeof getVisibleModuleGroups>;
  user: ReturnType<typeof useAuth>["user"];
  isLoading: boolean;
  onSignOut: () => void;
  onClose: () => void;
}

function MobileNavMenu({
  discoverItems,
  recommendedItems,
  showAdminLink,
  adminHomeModules,
  moduleGroups,
  user,
  isLoading,
  onSignOut,
  onClose,
}: MobileNavMenuProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  const navItemClass = (isActive: boolean) =>
    `block px-4 py-3 min-h-[44px] flex items-center rounded-md transition-colors ${
      isActive ? "bg-slate-800 text-primary-400 font-medium" : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;

  return (
    <div className="md:hidden border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm max-h-[70vh] overflow-y-auto">
      <div className="container-max py-4 space-y-1">
        {/* Discover */}
        {discoverItems.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleSection("discover")}
              className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-slate-300 hover:bg-slate-800 hover:text-white rounded-md font-medium"
            >
              Discover
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${expandedSection === "discover" ? "rotate-180" : ""}`}
              />
            </button>
            {expandedSection === "discover" && (
              <div className="pl-4 space-y-1">
                {discoverItems.map((m) => (
                  <NavLink key={m.path} to={m.path} className={({ isActive }) => navItemClass(isActive)} onClick={onClose}>
                    {m.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recommended */}
        {recommendedItems.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleSection("recommended")}
              className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-slate-300 hover:bg-slate-800 hover:text-white rounded-md font-medium"
            >
              Recommended
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${expandedSection === "recommended" ? "rotate-180" : ""}`}
              />
            </button>
            {expandedSection === "recommended" && (
              <div className="pl-4 space-y-1">
                {recommendedItems.map((m) => (
                  <NavLink key={m.path} to={m.path} className={({ isActive }) => navItemClass(isActive)} onClick={onClose}>
                    {m.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin */}
        {showAdminLink && (
          <NavLink to="/admin" className={({ isActive }) => navItemClass(isActive)} onClick={onClose}>
            Admin
          </NavLink>
        )}

        {/* Admin Home (sidebar items) */}
        {user && adminHomeModules.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleSection("admin-home")}
              className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-slate-300 hover:bg-slate-800 hover:text-white rounded-md font-medium"
            >
              Admin Home
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${expandedSection === "admin-home" ? "rotate-180" : ""}`}
              />
            </button>
            {expandedSection === "admin-home" && (
              <div className="pl-4 space-y-1">
                <NavLink to="/admin" className={({ isActive }) => navItemClass(isActive)} onClick={onClose}>
                  Admin Home
                </NavLink>
                {adminHomeModules.map((mod) => (
                  <NavLink
                    key={mod.path}
                    to={mod.path}
                    className={({ isActive }) => navItemClass(isActive)}
                    onClick={onClose}
                  >
                    {mod.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Modules (sidebar items) */}
        {user && moduleGroups.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleSection("modules")}
              className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-slate-300 hover:bg-slate-800 hover:text-white rounded-md font-medium"
            >
              Modules
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${expandedSection === "modules" ? "rotate-180" : ""}`}
              />
            </button>
            {expandedSection === "modules" && (
              <div className="pl-4 space-y-2">
                {moduleGroups.map((group) => (
                  <div key={group.id}>
                    <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {group.label}
                    </div>
                    {group.getLinks(user).map((link) => (
                      <NavLink
                        key={link.path}
                        to={link.path}
                        className={({ isActive }) => navItemClass(isActive)}
                        onClick={onClose}
                      >
                        {link.label}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Profile / Sign in / Sign out */}
        {user && (
          <>
            <NavLink to="/profile" className={({ isActive }) => navItemClass(isActive)} onClick={onClose}>
              Profile
            </NavLink>
            <button
              onClick={onSignOut}
              className="block w-full text-left px-4 py-3 min-h-[44px] flex items-center rounded-md text-red-400 hover:bg-slate-800 transition-colors font-medium"
            >
              Sign out
            </button>
          </>
        )}
        {!user && !isLoading && (
          <Link to="/auth" className={navItemClass(false)} onClick={onClose}>
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}
