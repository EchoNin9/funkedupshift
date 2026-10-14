import React, { useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";
import { useImpersonation } from "./ImpersonationContext";
import { applyServerPrefs, loadCatalog, resetUserTheme } from "./theme";
import { fetchProfilePrefs, setSyncUser } from "./profilePrefs";
import { hydratePins, resetPins } from "../hooks/usePins";
import { hydrateCollapsedGroups, resetCollapsedGroups } from "../hooks/useCollapsedGroups";

/**
 * Keeps <html data-theme data-palette> and the generated theme stylesheet in step with the server:
 * reads themes + site defaults once per page load, then (signed in) the user's themeId / mode / pins from the
 * profile. Cached values were already applied before first render (initTheme in main.tsx).
 * While impersonating nothing is read or written: GET/PUT /profile would act on the impersonated user.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const { impersonation } = useImpersonation();
  const impersonationKey = impersonation ? `${impersonation.type}:${impersonation.id}` : "";
  const hadUser = useRef(false);

  useEffect(() => {
    void loadCatalog();
  }, []);

  const userId = user?.userId ?? null;
  useEffect(() => {
    if (isLoading) return;
    setSyncUser(userId);
    if (!userId) {
      if (hadUser.current) {
        hadUser.current = false;
        resetUserTheme();
        resetPins();
        resetCollapsedGroups();
      }
      return;
    }
    hadUser.current = true;
    if (impersonationKey) return;
    let cancelled = false;
    void (async () => {
      const [prefs] = await Promise.all([fetchProfilePrefs(), loadCatalog()]);
      if (cancelled || !prefs) return;
      applyServerPrefs({ themeId: prefs.themeId, mode: prefs.mode });
      hydratePins(prefs.pins, userId);
      hydrateCollapsedGroups(prefs.collapsedGroups, userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, userId, impersonationKey]);

  return <>{children}</>;
}

export default ThemeProvider;
