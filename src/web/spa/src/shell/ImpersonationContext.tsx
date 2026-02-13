import React, { createContext, useContext, useCallback, useState, useEffect } from "react";

const STORAGE_KEY = "funkedupshift_impersonation";

export interface ImpersonationState {
  type: "user" | "role";
  id: string;
  label: string;
}

interface ImpersonationContextValue {
  impersonation: ImpersonationState | null;
  setImpersonation: (state: ImpersonationState | null) => void;
  clearImpersonation: () => void;
  getImpersonationHeaders: () => Record<string, string>;
}

const ImpersonationContext = createContext<ImpersonationContextValue | undefined>(undefined);

function loadStored(): ImpersonationState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (parsed?.type && parsed?.id) return parsed;
  } catch {}
  return null;
}

function saveStored(state: ImpersonationState | null) {
  try {
    if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export const ImpersonationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [impersonation, setImpersonationState] = useState<ImpersonationState | null>(loadStored);

  useEffect(() => {
    const stored = loadStored();
    setImpersonationState(stored);
  }, []);

  const setImpersonation = useCallback((state: ImpersonationState | null) => {
    setImpersonationState(state);
    saveStored(state);
  }, []);

  const clearImpersonation = useCallback(() => {
    setImpersonationState(null);
    saveStored(null);
  }, []);

  const getImpersonationHeaders = useCallback((): Record<string, string> => {
    const current = impersonation ?? loadStored();
    if (!current) return {};
    if (current.type === "user") return { "X-Impersonate-User": current.id };
    return { "X-Impersonate-Role": current.id };
  }, [impersonation]);

  const value: ImpersonationContextValue = {
    impersonation: impersonation ?? loadStored(),
    setImpersonation,
    clearImpersonation,
    getImpersonationHeaders
  };

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
};

export function useImpersonation(): ImpersonationContextValue {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) return {
    impersonation: null,
    setImpersonation: () => {},
    clearImpersonation: () => {},
    getImpersonationHeaders: () => ({})
  };
  return ctx;
}
