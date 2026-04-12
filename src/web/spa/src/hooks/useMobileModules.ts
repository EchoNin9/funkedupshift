import { useCallback, useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import type { AuthUser } from "../shell/AuthContext";
import { getVisiblePublicModules, type PublicModule } from "../config/modules";

const STORAGE_KEY = "mobile_enabled_modules";

export function useMobileModules(user: AuthUser | null) {
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
    async (moduleId: string) => {
      setEnabledIds((prev) => {
        const current = prev ?? accessible.map((m) => m.id);
        const next = current.includes(moduleId)
          ? current.filter((id) => id !== moduleId)
          : [...current, moduleId];
        Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(next) });
        return next;
      });
    },
    [accessible]
  );

  const isEnabled = useCallback(
    (moduleId: string) => {
      if (enabledIds === null) return true;
      return enabledIds.includes(moduleId);
    },
    [enabledIds]
  );

  return { enabledModules, accessible, toggleModule, isEnabled };
}
