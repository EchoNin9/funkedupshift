import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRightIcon, HomeIcon } from "@heroicons/react/24/outline";
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

const subNavLinkBase = "flex items-center gap-2 pl-8 pr-4 py-2 text-sm rounded-r-md transition-colors";

/** Accordion section: click to expand/collapse, sub-menus shown inline. */
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
  const Trigger = (
    <button
      type="button"
      className={`w-full text-left ${triggerClass}`}
      onClick={() => setExpanded((x) => !x)}
    >
      {Icon && <Icon className="w-5 h-5 shrink-0" />}
      {label}
      <ChevronRightIcon
        className={`w-4 h-4 shrink-0 ml-auto transition-transform ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {Trigger}
      {expanded && links.length > 0 && (
        <div className="flex flex-col gap-0.5 py-1">
          {links.map((m) => (
            <NavLink
              key={m.path}
              to={m.path}
              className={({ isActive: active }) =>
                `${subNavLinkBase} ${
                  active ? "bg-slate-800/70 text-primary-400 font-medium" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
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
            <div className={blockHeadingClass}>Modules</div>
            <nav className="flex flex-col gap-1">
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
