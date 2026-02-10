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

