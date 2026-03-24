import React, { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronRightIcon, HomeIcon } from "@heroicons/react/24/outline";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import {
  getVisibleAdminModules,
  getAdminHomeModules,
  getVisibleModuleGroups,
  type ModuleLink,
} from "../config/modules";

const sectionHeadingClass =
  "mb-1 px-4 py-2 text-xs font-medium uppercase tracking-wider text-text-tertiary";

const navLinkBase =
  "flex items-center gap-3 px-4 py-2 text-sm rounded-md mx-2 transition-colors duration-150";
const navLinkActive =
  "bg-surface-3 text-text-primary font-medium";
const navLinkInactive =
  "text-text-secondary hover:bg-surface-2 hover:text-text-primary";

const subNavLinkBase =
  "flex items-center gap-2 pl-10 pr-4 py-1.5 text-sm rounded-md mx-2 transition-colors duration-150";

/** Accordion section with animated expand/collapse. */
function AccordionSection({
  label,
  links,
  icon: Icon,
  defaultExpanded,
}: {
  label: string;
  links: ModuleLink[];
  icon: React.ComponentType<{ className?: string }>;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const location = useLocation();
  const isActive = links.some(
    (m) =>
      location.pathname === m.path || location.pathname.startsWith(m.path + "/")
  );

  if (links.length === 0) return null;

  const triggerClass = `${navLinkBase} ${isActive ? navLinkActive : navLinkInactive}`;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={`w-full text-left ${triggerClass}`}
        onClick={() => setExpanded((x) => !x)}
      >
        {Icon && <Icon className="w-5 h-5 shrink-0" />}
        <span className="flex-1">{label}</span>
        <ChevronRightIcon
          className={`w-3.5 h-3.5 shrink-0 text-text-tertiary transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-0.5 py-1">
              {links.map((m) => (
                <NavLink
                  key={m.path}
                  to={m.path}
                  className={({ isActive: active }) =>
                    `${subNavLinkBase} ${
                      active
                        ? "bg-surface-3/60 text-text-primary font-medium"
                        : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                    }`
                  }
                >
                  {m.label}
                </NavLink>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { AccordionSection };

export function LeftSidebar() {
  const { user } = useAuth();
  const { logo, siteName } = useBranding();
  const adminModules = getVisibleAdminModules(user);
  const adminHomeModules = getAdminHomeModules(user);
  const moduleGroups = getVisibleModuleGroups(user);

  const hasAdminAccess = adminModules.length > 0;
  const hasModuleAccess = moduleGroups.length > 0;
  const showSidebar = hasAdminAccess || hasModuleAccess;

  if (!showSidebar || !user) return null;

  const adminHomeLinks: ModuleLink[] = [
    { path: "/admin", label: "Admin Home" },
    ...adminHomeModules.map((m) => ({ path: m.path, label: m.label })),
  ];

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 md:left-0 md:z-40 border-r border-border-default bg-surface-1">
      {/* Brand section */}
      <div className="px-4 py-4 border-b border-border-subtle">
        <Link to="/" className="flex items-center gap-2.5">
          {logo?.url ? (
            <img
              src={logo.url}
              alt={logo.alt || siteName}
              className="w-6 h-6 rounded object-contain"
            />
          ) : (
            <div className="w-6 h-6 rounded bg-accent-500 flex items-center justify-center text-xs font-bold text-white">
              {siteName.charAt(0)}
            </div>
          )}
          <span className="text-sm font-semibold text-text-primary truncate">
            {siteName}
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-3 scrollbar-thin">
        {hasAdminAccess && (
          <div className="mb-3">
            <div className={sectionHeadingClass}>Admin</div>
            <nav className="flex flex-col gap-0.5">
              <AccordionSection
                label="Admin Home"
                links={adminHomeLinks}
                icon={HomeIcon}
                defaultExpanded={true}
              />
            </nav>
          </div>
        )}

        {hasModuleAccess && (
          <div>
            <div className={sectionHeadingClass}>Modules</div>
            <nav className="flex flex-col gap-0.5">
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
      </div>
    </aside>
  );
}
