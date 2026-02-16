import React from "react";

export interface AdminTab {
  id: string;
  label: string;
}

interface AdminTabsProps {
  tabs: AdminTab[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Tab list styled for admin pages (orangewhip-style).
 */
export function AdminTabs({ tabs, activeId, onSelect }: AdminTabsProps) {
  return (
    <div className="flex gap-1 rounded-lg border border-secondary-700/50 bg-secondary-900/30 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`min-h-[44px] flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeId === tab.id
              ? "bg-primary-500/20 text-primary-400"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
