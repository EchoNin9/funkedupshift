import React, { useState, useEffect, useCallback } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bars3Icon, XMarkIcon, HomeIcon } from "@heroicons/react/24/outline";
import { motion, AnimatePresence } from "framer-motion";
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
import { AccordionSection } from "./LeftSidebar";

export function MobileHeader() {
  const { user, isLoading, signOut } = useAuth();
  const { logo, siteName } = useBranding();
  const [panelOpen, setPanelOpen] = useState(false);
  const location = useLocation();

  const bySection = getPublicModulesBySection(user);
  const discoverIds = ["websites", "media", "memes", "internet-dashboard", "merch-store", "merch-support"] as const;
  const allForDiscover = [...(bySection.discover ?? []), ...(bySection.memes ?? [])];
  const discoverItems = discoverIds
    .map((id) => allForDiscover.find((m) => m.id === id))
    .filter((m): m is PublicModule => m != null);
  const recommendedItems = bySection.recommended ?? [];
  const adminModules = getVisibleAdminModules(user);
  const adminHomeModules = getAdminHomeModules(user);
  const moduleGroups = getVisibleModuleGroups(user);
  const showAdminLink = adminModules.length > 0;

  // Close panel on route change
  useEffect(() => setPanelOpen(false), [location.pathname]);

  // Lock body scroll when panel is open
  useEffect(() => {
    if (panelOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [panelOpen]);

  const handleSignOut = useCallback(() => {
    signOut();
    setPanelOpen(false);
  }, [signOut]);

  const close = useCallback(() => setPanelOpen(false), []);

  const navItemClass = (isActive: boolean) =>
    `flex items-center gap-3 px-4 py-2.5 min-h-[44px] text-sm rounded-md transition-colors duration-150 ${
      isActive ? "bg-surface-3 text-text-primary font-medium" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
    }`;

  const adminHomeLinks = [
    { path: "/admin", label: "Admin Home" },
    ...adminHomeModules.map((m) => ({ path: m.path, label: m.label })),
  ];

  return (
    <div className="md:hidden">
      <ImpersonationBanner />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-1 border-b border-border-default">
        <Link to="/" className="flex items-center gap-2.5">
          {logo?.url ? (
            <img
              src={logo.url}
              alt={logo.alt || siteName}
              className="h-7 w-auto rounded object-contain"
            />
          ) : (
            <div className="h-7 w-7 rounded bg-accent-500 flex items-center justify-center text-xs font-bold text-white">
              {siteName.charAt(0)}
            </div>
          )}
          <span className="text-sm font-semibold text-text-primary">
            {siteName}
          </span>
        </Link>

        <div className="flex items-center gap-1">
          {user && <ImpersonationSelector />}
          <button
            type="button"
            onClick={() => setPanelOpen(!panelOpen)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-md hover:bg-surface-2 transition-colors duration-150"
            aria-label={panelOpen ? "Close menu" : "Open menu"}
          >
            {panelOpen ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Slide-out sidebar overlay */}
      <AnimatePresence>
        {panelOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={close}
            />

            {/* Panel */}
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.1}
              onDragEnd={(_e, info) => {
                if (info.offset.x < -80) close();
              }}
              className="fixed top-0 left-0 bottom-0 z-50 w-72 bg-surface-1 border-r border-border-default overflow-y-auto"
            >
              {/* Panel header */}
              <div className="px-4 py-4 border-b border-border-subtle flex items-center justify-between">
                <Link to="/" onClick={close} className="flex items-center gap-2.5">
                  {logo?.url ? (
                    <img
                      src={logo.url}
                      alt={logo.alt || siteName}
                      className="h-6 w-auto rounded object-contain"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded bg-accent-500 flex items-center justify-center text-xs font-bold text-white">
                      {siteName.charAt(0)}
                    </div>
                  )}
                  <span className="text-sm font-semibold text-text-primary">
                    {siteName}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={close}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-md hover:bg-surface-2 transition-colors duration-150"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation */}
              <div className="py-3 space-y-4">
                {/* Discover */}
                {discoverItems.length > 0 && (
                  <div>
                    <div className="px-4 py-1 text-xs font-medium uppercase tracking-wider text-text-tertiary">
                      Discover
                    </div>
                    <nav className="mt-1 flex flex-col gap-0.5 px-2">
                      {discoverItems.map((m) => (
                        <NavLink
                          key={m.path}
                          to={m.path}
                          onClick={close}
                          className={({ isActive }) => navItemClass(isActive)}
                        >
                          {m.label}
                        </NavLink>
                      ))}
                    </nav>
                  </div>
                )}

                {/* Recommended */}
                {recommendedItems.length > 0 && (
                  <div>
                    <div className="px-4 py-1 text-xs font-medium uppercase tracking-wider text-text-tertiary">
                      Recommended
                    </div>
                    <nav className="mt-1 flex flex-col gap-0.5 px-2">
                      {recommendedItems.map((m) => (
                        <NavLink
                          key={m.path}
                          to={m.path}
                          onClick={close}
                          className={({ isActive }) => navItemClass(isActive)}
                        >
                          {m.label}
                        </NavLink>
                      ))}
                    </nav>
                  </div>
                )}

                {/* Admin sidebar items */}
                {showAdminLink && (
                  <div>
                    <div className="px-4 py-1 text-xs font-medium uppercase tracking-wider text-text-tertiary">
                      Admin
                    </div>
                    <nav className="mt-1 flex flex-col gap-0.5">
                      <AccordionSection
                        label="Admin Home"
                        links={adminHomeLinks}
                        icon={HomeIcon}
                        defaultExpanded={false}
                      />
                    </nav>
                  </div>
                )}

                {/* Module groups */}
                {user && moduleGroups.length > 0 && (
                  <div>
                    <div className="px-4 py-1 text-xs font-medium uppercase tracking-wider text-text-tertiary">
                      Modules
                    </div>
                    <nav className="mt-1 flex flex-col gap-0.5">
                      {moduleGroups.map((group) => (
                        <AccordionSection
                          key={group.id}
                          label={group.label}
                          links={group.getLinks(user)}
                          icon={group.icon}
                        />
                      ))}
                    </nav>
                  </div>
                )}

                {/* Auth section */}
                <div className="border-t border-border-subtle pt-3 px-2">
                  {user ? (
                    <>
                      <div className="px-4 py-2 text-xs text-text-tertiary truncate">
                        {user.email}
                      </div>
                      <NavLink
                        to="/profile"
                        onClick={close}
                        className={({ isActive }) => navItemClass(isActive)}
                      >
                        Profile
                      </NavLink>
                      <button
                        onClick={handleSignOut}
                        className="flex items-center w-full px-4 py-2.5 min-h-[44px] text-sm text-red-400 hover:bg-surface-2 rounded-md transition-colors duration-150"
                      >
                        Sign out
                      </button>
                    </>
                  ) : isLoading ? (
                    <span className="px-4 py-2 text-xs text-text-tertiary">Loading...</span>
                  ) : (
                    <Link
                      to="/auth"
                      onClick={close}
                      className="flex items-center justify-center mx-2 py-2 btn-primary text-sm"
                    >
                      Sign in
                    </Link>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
