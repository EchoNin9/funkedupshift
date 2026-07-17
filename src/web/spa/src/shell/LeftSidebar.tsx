import React, { createContext, useCallback, useContext, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRightIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  HomeIcon,
  ChartBarIcon,
  PhotoIcon,
  GlobeAltIcon,
  LockClosedIcon,
  TruckIcon,
  TrophyIcon,
  CurrencyDollarIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
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
  "bg-surface-3 text-nav font-medium border-l-2 border-nav";
const navLinkInactive =
  "text-text-secondary hover:bg-surface-2 hover:text-text-primary";
const navLinkLocked =
  "text-text-tertiary opacity-50 grayscale cursor-not-allowed hover:bg-transparent hover:text-text-tertiary";

const subNavLinkBase =
  "flex items-center gap-2 pl-10 pr-4 py-1.5 text-sm rounded-md mx-2 transition-colors duration-150";

/* ── "Basics" — always-public top links, first in the sidebar. ── */
const BASIC_LINKS: { path: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { path: "/", label: "Home", icon: HomeIcon },
  { path: "/internet-dashboard", label: "Internet Dashboard", icon: ChartBarIcon },
  { path: "/media", label: "Media", icon: PhotoIcon },
  { path: "/websites", label: "Websites", icon: GlobeAltIcon },
];

/** Canonical module-group metadata, shown regardless of access (locked ones greyed).
 *  Mirrors the ids/labels/icons in config/modules.ts MODULE_GROUPS. */
const MODULE_GROUP_META: { id: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "memes", label: "Memes", icon: PhotoIcon },
  { id: "expenses", label: "Expenses", icon: TruckIcon },
  { id: "squash", label: "Squash", icon: TrophyIcon },
  { id: "financial", label: "Financial", icon: CurrencyDollarIcon },
  { id: "tools", label: "Tools", icon: LinkIcon },
];

/* ── Whole-sidebar collapse state, persisted in localStorage. Shared between
   LeftSidebar (which renders the rail) and AppLayout (which offsets content). ── */
const COLLAPSE_KEY = "funkedupshift_sidebar_collapsed";

interface SidebarCollapseContextValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
}
const SidebarCollapseContext = createContext<SidebarCollapseContextValue>({
  collapsed: false,
  toggleCollapsed: () => {},
});

export const SidebarCollapseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* localStorage unavailable (private mode, etc) — collapse still works, just not persisted */
      }
      return next;
    });
  }, []);

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, toggleCollapsed }}>
      {children}
    </SidebarCollapseContext.Provider>
  );
};

export function useSidebarCollapse(): SidebarCollapseContextValue {
  return useContext(SidebarCollapseContext);
}

/** A single greyed-out, non-navigating row for a module group the viewer can't access.
 *  Guests are routed to /auth; logged-in users without access are inert with a tooltip. */
function LockedGroupRow({
  label,
  icon: Icon,
  collapsed,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleClick = () => {
    if (!user) navigate("/auth");
    // logged-in without access: inert, no-op
  };

  const title = user ? "You don't have access to this module" : "Sign in to unlock";

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-disabled={!!user}
      className={`${navLinkBase} ${navLinkLocked} w-full text-left`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      {!collapsed && (
        <span className="flex-1 flex items-center gap-1.5 truncate">
          {label}
          <LockClosedIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/** Accordion section with animated expand/collapse. In `collapsed` (icon-rail) mode
 *  it renders as a single icon that navigates straight to the first link. */
function AccordionSection({
  label,
  links,
  icon: Icon,
  defaultExpanded,
  collapsed,
  onLinkClick,
}: {
  label: string;
  links: ModuleLink[];
  icon: React.ComponentType<{ className?: string }>;
  defaultExpanded?: boolean;
  collapsed?: boolean;
  onLinkClick?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const location = useLocation();
  const isActive = links.some(
    (m) =>
      location.pathname === m.path || location.pathname.startsWith(m.path + "/")
  );

  if (links.length === 0) return null;

  const triggerClass = `${navLinkBase} ${isActive ? navLinkActive : navLinkInactive}`;

  if (collapsed) {
    return (
      <Link
        to={links[0].path}
        title={label}
        onClick={onLinkClick}
        className={triggerClass}
      >
        {Icon && <Icon className="w-5 h-5 shrink-0" />}
      </Link>
    );
  }

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
                  onClick={onLinkClick}
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

/** Shared nav content: Basics → Modules (all groups, locked ones greyed) → Admin
 *  (only when non-empty). Used by both the desktop rail (LeftSidebar) and the
 *  mobile slide-in drawer (MobileHeader) — same component, two presentations. */
export function SidebarNavSections({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { user, isLoading } = useAuth();

  const basicLinks = (
    <div className="mb-3">
      {!collapsed && <div className={sectionHeadingClass}>Basics</div>}
      <nav className="flex flex-col gap-0.5">
        {BASIC_LINKS.map((l) => (
          <NavLink
            key={l.path}
            to={l.path}
            end={l.path === "/"}
            onClick={onNavigate}
            title={collapsed ? l.label : undefined}
            className={({ isActive }) => `${navLinkBase} ${isActive ? navLinkActive : navLinkInactive}`}
          >
            <l.icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{l.label}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );

  // Auth still resolving — show the (always-public) basics and a neutral
  // placeholder for modules rather than flashing everything as locked.
  if (isLoading) {
    return (
      <>
        {basicLinks}
        {!collapsed && (
          <div className="px-4 py-2 text-xs text-text-tertiary">Loading…</div>
        )}
      </>
    );
  }

  const adminModules = getVisibleAdminModules(user);
  const adminHomeModules = getAdminHomeModules(user);
  const visibleGroups = getVisibleModuleGroups(user);
  const hasAdminAccess = adminModules.length > 0;

  const adminHomeLinks: ModuleLink[] = [
    { path: "/admin", label: "Admin Home" },
    ...adminHomeModules.map((m) => ({ path: m.path, label: m.label })),
  ];

  return (
    <>
      {basicLinks}

      <div className="mb-3">
        {!collapsed && <div className={sectionHeadingClass}>Modules</div>}
        <nav className="flex flex-col gap-0.5">
          {MODULE_GROUP_META.map((meta) => {
            const group = visibleGroups.find((g) => g.id === meta.id);
            if (group) {
              return (
                <AccordionSection
                  key={meta.id}
                  label={meta.label}
                  links={group.getLinks(user)}
                  icon={meta.icon}
                  collapsed={collapsed}
                  onLinkClick={onNavigate}
                />
              );
            }
            return (
              <LockedGroupRow key={meta.id} label={meta.label} icon={meta.icon} collapsed={collapsed} />
            );
          })}
        </nav>
      </div>

      {hasAdminAccess && (
        <div>
          {!collapsed && <div className={sectionHeadingClass}>Admin</div>}
          <nav className="flex flex-col gap-0.5">
            <AccordionSection
              label="Admin Home"
              links={adminHomeLinks}
              icon={HomeIcon}
              defaultExpanded={!collapsed}
              collapsed={collapsed}
              onLinkClick={onNavigate}
            />
          </nav>
        </div>
      )}
    </>
  );
}

export function LeftSidebar() {
  const { logo, siteName } = useBranding();
  const { collapsed, toggleCollapsed } = useSidebarCollapse();

  return (
    <aside
      className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:z-40 border-r border-border-default bg-surface-1 transition-[width] duration-150 ${
        collapsed ? "md:w-16" : "md:w-60"
      }`}
    >
      {/* Brand section */}
      <div className={`px-4 py-4 border-b border-border-subtle flex items-center ${collapsed ? "justify-center" : ""}`}>
        <Link to="/" className="flex items-center gap-2.5 min-w-0" title={collapsed ? siteName : undefined}>
          {logo?.url ? (
            <img
              src={logo.url}
              alt={logo.alt || siteName}
              className="w-6 h-6 rounded object-contain shrink-0"
            />
          ) : (
            <div className="w-6 h-6 rounded bg-accent-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {siteName.charAt(0)}
            </div>
          )}
          {!collapsed && (
            <span className="text-sm font-semibold text-text-primary truncate">
              {siteName}
            </span>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-3 scrollbar-thin">
        <SidebarNavSections collapsed={collapsed} />
      </div>

      {/* Whole-sidebar collapse toggle */}
      <div className="border-t border-border-subtle p-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-2 rounded-md transition-colors duration-150"
        >
          {collapsed ? (
            <ChevronDoubleRightIcon className="w-4 h-4 shrink-0" />
          ) : (
            <>
              <ChevronDoubleLeftIcon className="w-4 h-4 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
