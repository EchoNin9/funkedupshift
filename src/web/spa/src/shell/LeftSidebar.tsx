import React, { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronDownIcon, HomeIcon } from "@heroicons/react/24/outline";
import { useAuth } from "./AuthContext";
import {
  getVisibleAdminModules,
  getAdminHomeModules,
  getVisibleModuleGroups,
  type ModuleLink,
} from "../config/modules";

const blockHeadingClass =
  "mb-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500";

const navLinkBase =
  "flex items-center gap-3 px-4 py-2.5 text-sm rounded-r-md transition-colors";
const navLinkActive =
  "bg-slate-800 text-primary-400 font-medium border-l-2 border-primary-500 -ml-px";
const navLinkInactive = "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200";

/** Flyout panel that opens to the right on hover. Trigger can be a link or a non-link label. */
function FlyoutExpandable({
  label,
  links,
  icon: Icon,
  primaryPath,
}: {
  label: string;
  links: ModuleLink[];
  icon: React.ComponentType<{ className?: string }>;
  /** When set, trigger is a Link; when null, trigger is a non-link (for Modules groups). */
  primaryPath: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const isActive = links.some(
    (m) =>
      location.pathname === m.path || location.pathname.startsWith(m.path + "/")
  );

  if (links.length === 0) return null;

  const triggerClass = `${navLinkBase} ${isActive ? navLinkActive : navLinkInactive}`;
  const Trigger = primaryPath ? (
    <Link to={primaryPath} className={triggerClass}>
      {Icon && <Icon className="w-5 h-5 shrink-0" />}
      {label}
      <ChevronDownIcon
        className={`w-4 h-4 shrink-0 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
      />
    </Link>
  ) : (
    <div className={triggerClass}>
      {Icon && <Icon className="w-5 h-5 shrink-0" />}
      {label}
      <ChevronDownIcon
        className={`w-4 h-4 shrink-0 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
      />
    </div>
  );

  return (
    <div
      className="relative"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {Trigger}
      {expanded && links.length > 0 && (
        <div className="absolute left-full top-0 ml-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl z-50">
          {links.map((m) => (
            <NavLink
              key={m.path}
              to={m.path}
              className={({ isActive: active }) =>
                `block px-4 py-2.5 text-sm transition-colors ${
                  active ? "bg-slate-800 text-primary-400 font-medium" : "text-slate-300 hover:bg-slate-800 hover:text-white"
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

export function LeftSidebar() {
  const { user } = useAuth();
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
    <aside className="hidden md:flex md:w-56 md:flex-col md:fixed md:top-14 md:bottom-0 md:left-0 md:z-40 border-r border-slate-800 bg-slate-950">
      <div className="flex-1 overflow-y-auto py-4">
        {hasAdminAccess && (
          <div className="mb-4">
            <div className={blockHeadingClass}>Admin Home</div>
            <nav className="flex flex-col gap-1">
              <FlyoutExpandable
                label="Admin Home"
                links={adminHomeLinks}
                icon={HomeIcon}
                primaryPath="/admin"
              />
            </nav>
          </div>
        )}

        {hasModuleAccess && (
          <div>
            <div className={blockHeadingClass}>Modules</div>
            <nav className="flex flex-col gap-1">
              {moduleGroups.map((group) => (
                <FlyoutExpandable
                  key={group.id}
                  label={group.label}
                  links={group.getLinks(user)}
                  icon={group.icon}
                  primaryPath={null}
                />
              ))}
            </nav>
          </div>
        )}
      </div>
    </aside>
  );
}
