import React, { createContext, useContext, useEffect, useState } from "react";

export type UserRole = "superadmin" | "manager" | "user" | "guest";

export interface AuthUser {
  userId: string;
  email: string;
  groups: string[];
  role: UserRole;
  customGroups?: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signOut: () => void;
  refreshAuth: () => Promise<void>;
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

  const bootstrap = React.useCallback(async () => {
      const apiBase = getApiBaseUrl();
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
            setUser(null);
            setIsLoading(false);
            resolve();
            return;
          }
          resolve();
        });
      });

      const token = await new Promise<string | null>((resolve) => {
        (window as any).auth.getAccessToken((t: string | null) => resolve(t));
      });
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const resp = await fetch(`${apiBase}/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const data = await resp.json();

      const groups: string[] = Array.isArray(data.groups) ? data.groups.map(String) : [];
      const role = mapGroupsToRole(groups);
      const customGroups: string[] = Array.isArray(data.customGroups) ? data.customGroups.map(String) : [];

      setUser({
        userId: String(data.userId || ""),
        email: String(data.email || ""),
        groups,
        role,
        customGroups
      });
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const refreshAuth = React.useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    await bootstrap();
  }, [bootstrap]);

  const signOut = () => {
    const w = window as any;
    if (w.auth && typeof w.auth.signOut === "function") {
      w.auth.signOut();
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, refreshAuth }}>
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
  if (role === "guest") return true;
  if (!user) return false;
  const order: UserRole[] = ["guest", "user", "manager", "superadmin"];
  return order.indexOf(user.role) >= order.indexOf(role);
}

export function canAccessSquash(user: AuthUser | null): boolean {
  if (!user?.userId) return false;
  if (user.role === "superadmin") return true;
  return (user.customGroups ?? []).includes("Squash");
}

export function canModifySquash(user: AuthUser | null): boolean {
  if (!user?.userId) return false;
  if (user.role === "superadmin") return true;
  if (user.role !== "manager") return false;
  return (user.customGroups ?? []).includes("Squash");
}

