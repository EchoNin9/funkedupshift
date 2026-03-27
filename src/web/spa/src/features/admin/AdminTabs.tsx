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
    <div className="flex gap-1 rounded-lg border border-border-hover bg-surface-2 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`min-h-[44px] flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeId === tab.id
              ? "bg-accent-500/20 text-accent-400"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
