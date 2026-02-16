import React, { useState, useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import { useImpersonation } from "./ImpersonationContext";
import { getVisiblePublicModules, getVisibleAdminModules } from "../config/modules";
import ImpersonationBanner from "./ImpersonationBanner";
import ImpersonationSelector from "./ImpersonationSelector";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `transition-colors duration-200 ${isActive ? "text-primary-400 font-semibold" : "text-slate-300 hover:text-white"}`;

export function Header() {
  const { user, isLoading, signOut } = useAuth();
  const { logo, siteName } = useBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const location = useLocation();

  const publicItems = getVisiblePublicModules(user);
  const adminItems = getVisibleAdminModules(user);
  const showAdminLink = adminItems.length > 0;

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

  const mobileNavItems = [
    ...publicItems.map((m) => ({ path: m.path, label: m.label })),
    ...(showAdminLink ? [{ path: "/admin", label: "Admin" }] : []),
  ];

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

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium">
          {publicItems.map((item) => (
            <NavLink key={item.path} to={item.path} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
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

      {/* Mobile menu - inline, no Dialog */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm">
          <div className="container-max py-4 space-y-1">
            {mobileNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `block px-4 py-3 min-h-[44px] flex items-center rounded-md transition-colors ${
                    isActive
                      ? "bg-slate-800 text-primary-400 font-medium"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`
                }
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
            {user && (
              <button
                onClick={handleSignOut}
                className="block w-full text-left px-4 py-3 min-h-[44px] flex items-center rounded-md text-red-400 hover:bg-slate-800 transition-colors font-medium"
              >
                Sign out
              </button>
            )}
            {!user && !isLoading && (
              <Link
                to="/auth"
                className="block px-4 py-3 min-h-[44px] flex items-center rounded-md text-primary-400 hover:bg-slate-800 font-medium"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
