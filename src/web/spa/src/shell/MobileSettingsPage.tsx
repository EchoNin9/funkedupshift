import React from "react";
import { useAuth } from "./AuthContext";
import { useMobileModules } from "../hooks/useMobileModules";

export default function MobileSettingsPage() {
  const { user, signOut } = useAuth();
  const { accessible, toggleModule, isEnabled } = useMobileModules(user);

  const modules = accessible.filter(
    (m) => m.id !== "profile" && !m.id.includes("admin")
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Settings</h1>

      <section>
        <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">
          Visible Modules
        </h2>
        <p className="text-xs text-text-tertiary mb-4">
          Choose which modules appear in the bottom navigation.
        </p>
        <div className="space-y-1">
          {modules.map((mod) => (
            <label
              key={mod.id}
              className="flex items-center justify-between px-4 py-3 min-h-[44px] rounded-lg bg-surface-1 cursor-pointer"
            >
              <span className="text-sm text-text-primary">{mod.label}</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={isEnabled(mod.id)}
                  onChange={() => toggleModule(mod.id)}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 rounded-full bg-surface-3 peer-checked:bg-accent-500 transition-colors duration-200" />
                <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-4" />
              </div>
            </label>
          ))}
          {modules.length === 0 && (
            <p className="text-sm text-text-tertiary px-4 py-3">
              No modules available. Log in to access more features.
            </p>
          )}
        </div>
      </section>

      {user && (
        <section>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">
            Account
          </h2>
          <button
            onClick={signOut}
            className="w-full px-4 py-3 min-h-[44px] text-left text-sm text-red-400 bg-surface-1 rounded-lg"
          >
            Sign Out
          </button>
        </section>
      )}
    </div>
  );
}
