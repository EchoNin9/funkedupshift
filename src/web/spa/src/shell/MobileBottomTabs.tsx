import React from "react";
import { NavLink } from "react-router-dom";
import {
  HomeIcon,
  TruckIcon,
  GlobeAltIcon,
  PhotoIcon,
  TrophyIcon,
  CurrencyDollarIcon,
  SparklesIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
  HomeIcon as HomeIconSolid,
  Squares2X2Icon as Squares2X2IconSolid,
} from "@heroicons/react/24/solid";
import { useMobileModulesCtx } from "./MobileModulesContext";

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  websites: GlobeAltIcon,
  media: PhotoIcon,
  squash: TrophyIcon,
  financial: CurrencyDollarIcon,
  "vehicles-expenses": TruckIcon,
  "general-expenses": TruckIcon,
  memes: PhotoIcon,
  highlights: SparklesIcon,
  "highest-rated": SparklesIcon,
};

interface TabDef {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeIcon?: React.ComponentType<{ className?: string }>;
}

export function MobileBottomTabs() {
  const { enabledModules } = useMobileModulesCtx();

  const tabs: TabDef[] = [
    { path: "/", label: "Home", icon: HomeIcon, activeIcon: HomeIconSolid },
  ];

  // Add enabled modules as tabs (max 3 to keep total at 5 with Home + More)
  const moduleTabs = enabledModules
    .filter((m) => m.id !== "profile" && !m.id.includes("admin"))
    .slice(0, 3);

  for (const mod of moduleTabs) {
    const icon = MODULE_ICONS[mod.id] || GlobeAltIcon;
    tabs.push({
      path: mod.path,
      label: mod.label.length > 10 ? mod.label.slice(0, 9) + "\u2026" : mod.label,
      icon,
    });
  }

  // Always show "More" tab for full module navigation
  tabs.push({
    path: "/more",
    label: "More",
    icon: Squares2X2Icon,
    activeIcon: Squares2X2IconSolid,
  });

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface-1 border-t border-border-default"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full transition-colors duration-150 ${
                isActive ? "text-accent-500" : "text-text-tertiary"
              }`
            }
          >
            {({ isActive }) => {
              const Icon = isActive && tab.activeIcon ? tab.activeIcon : tab.icon;
              return (
                <>
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] mt-0.5 leading-tight">{tab.label}</span>
                </>
              );
            }}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
