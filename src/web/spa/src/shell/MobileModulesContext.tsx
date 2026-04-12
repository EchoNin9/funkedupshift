import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import type { AuthUser } from "./AuthContext";
import { useAuth } from "./AuthContext";
import { getVisiblePublicModules, type PublicModule } from "../config/modules";

const STORAGE_KEY = "mobile_enabled_modules";

interface MobileModulesState {
  /** Modules visible in the bottom tab bar (filtered by user toggles). */
  enabledModules: PublicModule[];
  /** All modules the user has permission to see. */
  accessible: PublicModule[];
  /** Toggle a module on/off in the tab bar. */
  toggleModule: (moduleId: string) => void;
  /** Check if a module is enabled in the tab bar. */
  isEnabled: (moduleId: string) => boolean;
}

const MobileModulesCtx = createContext<MobileModulesState>({
  enabledModules: [],
  accessible: [],
  toggleModule: () => {},
  isEnabled: () => true,
});

export function MobileModulesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [enabledIds, setEnabledIds] = useState<string[] | null>(null);
  const accessible = getVisiblePublicModules(user);

  useEffect(() => {
    Preferences.get({ key: STORAGE_KEY }).then(({ value }) => {
      if (value) {
        try {
          setEnabledIds(JSON.parse(value));
        } catch {
          setEnabledIds(accessible.map((m) => m.id));
        }
      } else {
        setEnabledIds(accessible.map((m) => m.id));
      }
    });
  }, [user]);

  const enabledModules: PublicModule[] =
    enabledIds === null
      ? accessible
      : accessible.filter((m) => enabledIds.includes(m.id));

  const toggleModule = useCallback(
    (moduleId: string) => {
      setEnabledIds((prev) => {
        const current = prev ?? accessible.map((m) => m.id);
        const next = current.includes(moduleId)
          ? current.filter((id) => id !== moduleId)
          : [...current, moduleId];
        Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(next) });
        return next;
      });
    },
    [accessible],
  );

  const isEnabled = useCallback(
    (moduleId: string) => {
      if (enabledIds === null) return true;
      return enabledIds.includes(moduleId);
    },
    [enabledIds],
  );

  return (
    <MobileModulesCtx.Provider value={{ enabledModules, accessible, toggleModule, isEnabled }}>
      {children}
    </MobileModulesCtx.Provider>
  );
}

export function useMobileModulesCtx() {
  return useContext(MobileModulesCtx);
}
