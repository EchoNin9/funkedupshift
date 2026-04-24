import React from "react";
import { Link } from "react-router-dom";
import {
  GlobeAltIcon,
  PhotoIcon,
  TrophyIcon,
  CurrencyDollarIcon,
  TruckIcon,
  SparklesIcon,
  ChartBarIcon,
  IdentificationIcon,
  Cog6ToothIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { useMobileModulesCtx } from "./MobileModulesContext";
import { useAuth } from "./AuthContext";
import { hasRole } from "./AuthContext";
import { getVisibleModuleGroups } from "../config/modules";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  websites: GlobeAltIcon,
  media: PhotoIcon,
  "internet-dashboard": ChartBarIcon,
  "my-info": IdentificationIcon,
  squash: TrophyIcon,
  "squash-admin": ShieldCheckIcon,
  memes: PhotoIcon,
  "meme-generator": PhotoIcon,
  financial: CurrencyDollarIcon,
  "financial-admin": CurrencyDollarIcon,
  "vehicles-expenses": TruckIcon,
  "general-expenses": TruckIcon,
  highlights: SparklesIcon,
  "highest-rated": SparklesIcon,
  profile: Cog6ToothIcon,
};

export default function MobileMorePage() {
  const { accessible } = useMobileModulesCtx();
  const { user } = useAuth();
  const moduleGroups = getVisibleModuleGroups(user);

  /* Build grouped navigation: module groups first, then standalone items */
  const groupedIds = new Set<string>();
  for (const g of moduleGroups) {
    for (const link of g.getLinks(user)) {
      const mod = accessible.find((m) => m.path === link.path);
      if (mod) groupedIds.add(mod.id);
    }
  }

  const standalone = accessible.filter(
    (m) => !groupedIds.has(m.id) && m.id !== "profile",
  );

  const showAdmin = hasRole(user, "manager");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Browse</h1>

      {/* Standalone modules */}
      {standalone.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2 px-1">
            Modules
          </h2>
          <div className="rounded-xl bg-surface-1 overflow-hidden divide-y divide-border-default">
            {standalone.map((mod) => {
              const Icon = ICON_MAP[mod.id] || GlobeAltIcon;
              return (
                <Link
                  key={mod.id}
                  to={mod.path}
                  className="flex items-center gap-3 px-4 py-3 min-h-[48px] active:bg-surface-2 transition-colors"
                >
                  <Icon className="w-5 h-5 text-text-tertiary flex-shrink-0" />
                  <span className="flex-1 text-sm text-text-primary">{mod.label}</span>
                  <ChevronRightIcon className="w-4 h-4 text-text-tertiary" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Module groups (Expenses, Squash, Financial, Memes) */}
      {moduleGroups.map((group) => {
        const links = group.getLinks(user);
        if (links.length === 0) return null;
        const GroupIcon = group.icon;
        return (
          <section key={group.id}>
            <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2 px-1 flex items-center gap-1.5">
              <GroupIcon className="w-3.5 h-3.5" />
              {group.label}
            </h2>
            <div className="rounded-xl bg-surface-1 overflow-hidden divide-y divide-border-default">
              {links.map((link) => {
                const mod = accessible.find((m) => m.path === link.path);
                const Icon = mod ? (ICON_MAP[mod.id] || GlobeAltIcon) : GlobeAltIcon;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className="flex items-center gap-3 px-4 py-3 min-h-[48px] active:bg-surface-2 transition-colors"
                  >
                    <Icon className="w-5 h-5 text-text-tertiary flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary">{link.label}</span>
                    <ChevronRightIcon className="w-4 h-4 text-text-tertiary" />
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Admin link */}
      {showAdmin && (
        <section>
          <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2 px-1">
            Administration
          </h2>
          <div className="rounded-xl bg-surface-1 overflow-hidden">
            <Link
              to="/admin"
              className="flex items-center gap-3 px-4 py-3 min-h-[48px] active:bg-surface-2 transition-colors"
            >
              <ShieldCheckIcon className="w-5 h-5 text-text-tertiary flex-shrink-0" />
              <span className="flex-1 text-sm text-text-primary">Admin Dashboard</span>
              <ChevronRightIcon className="w-4 h-4 text-text-tertiary" />
            </Link>
          </div>
        </section>
      )}

      {/* Settings link */}
      <section>
        <div className="rounded-xl bg-surface-1 overflow-hidden">
          <Link
            to="/mobile-settings"
            className="flex items-center gap-3 px-4 py-3 min-h-[48px] active:bg-surface-2 transition-colors"
          >
            <Cog6ToothIcon className="w-5 h-5 text-text-tertiary flex-shrink-0" />
            <span className="flex-1 text-sm text-text-primary">Settings</span>
            <ChevronRightIcon className="w-4 h-4 text-text-tertiary" />
          </Link>
        </div>
      </section>
    </div>
  );
}
