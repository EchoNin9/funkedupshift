import React, { createContext, useContext, useEffect, useState } from "react";

export type UserRole = "superadmin" | "manager" | "user" | "guest";

export interface AuthUser {
  userId: string;
  email: string;
  groups: string[];
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapGroupsToRole(groups: string[]): UserRole {
  if (groups.includes("admin")) return "superadmin";
  if (groups.includes("manager")) return "manager";
  if (groups.includes("user")) return "user";
  return "guest";
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const apiBase = getApiBaseUrl();

      // #region agent log
      fetch("http://127.0.0.1:7243/ingest/51517f45-4cb4-45b6-9d26-950ab96994fd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `log_${Date.now()}_auth_bootstrap_api_base`,
          timestamp: Date.now(),
          runId: "initial",
          hypothesisId: "H2",
          location: "AuthContext.tsx:bootstrap",
          message: "Auth bootstrap: API base and window flags",
          data: {
            apiBase,
            hasWindowApiBaseUrl: typeof (window as any).API_BASE_URL !== "undefined",
            hasAuthObject: typeof (window as any).auth !== "undefined"
          }
        })
      }).catch(() => {});
      // #endregion agent log

      if (!apiBase) {
        setIsLoading(false);
        return;
      }

      try {
        const w = window as any;
        if (!w.auth || typeof w.auth.getAccessToken !== "function") {
          setIsLoading(false);
          return;
        }

        await new Promise<void>((resolve) => {
          w.auth.isAuthenticated((ok: boolean) => {
            if (!ok) {
              if (!cancelled) {
                setUser(null);
                setIsLoading(false);
              }
              resolve();
              return;
            }
            resolve();
          });
        });

        const token = await new Promise<string | null>((resolve) => {
          (window as any).auth.getAccessToken((t: string | null) => resolve(t));
        });

        // #region agent log
        fetch("http://127.0.0.1:7243/ingest/51517f45-4cb4-45b6-9d26-950ab96994fd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: `log_${Date.now()}_auth_token_status`,
            timestamp: Date.now(),
            runId: "initial",
            hypothesisId: "H1",
            location: "AuthContext.tsx:bootstrap",
            message: "Auth bootstrap: token and isAuthenticated result",
            data: {
              hasToken: !!token
            }
          })
        }).catch(() => {});
        // #endregion agent log

        if (!token) {
          if (!cancelled) {
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        const resp = await fetch(`${apiBase}/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!resp.ok) {
          if (!cancelled) {
            setUser(null);
            setIsLoading(false);
          }
          return;
        }
        const data = await resp.json();

        // #region agent log
        fetch("http://127.0.0.1:7243/ingest/51517f45-4cb4-45b6-9d26-950ab96994fd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: `log_${Date.now()}_auth_me_response`,
            timestamp: Date.now(),
            runId: "initial",
            hypothesisId: "H3",
            location: "AuthContext.tsx:bootstrap",
            message: "Auth bootstrap: /me response summary",
            data: {
              hasUserId: !!data?.userId,
              hasEmail: !!data?.email,
              groupsLength: Array.isArray(data?.groups) ? data.groups.length : 0
            }
          })
        }).catch(() => {});
        // #endregion agent log

        if (cancelled) return;

        const groups: string[] = Array.isArray(data.groups) ? data.groups.map(String) : [];
        const role = mapGroupsToRole(groups);

        setUser({
          userId: String(data.userId || ""),
          email: String(data.email || ""),
          groups,
          role
        });
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = () => {
    const w = window as any;
    if (w.auth && typeof w.auth.signOut === "function") {
      w.auth.signOut();
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function hasRole(user: AuthUser | null, role: UserRole): boolean {
  if (!user) return false;
  const order: UserRole[] = ["guest", "user", "manager", "superadmin"];
  return order.indexOf(user.role) >= order.indexOf(role);
}

