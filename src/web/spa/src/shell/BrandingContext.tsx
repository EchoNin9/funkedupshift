import React, { createContext, useContext, useEffect, useState } from "react";

interface LogoMeta {
  url: string;
  alt: string;
}

interface BrandingContextValue {
  logo: LogoMeta | null;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logo, setLogo] = useState<LogoMeta | null>(null);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;

    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${apiBase}/branding/logo`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (cancelled) return;
        if (data && data.url) {
          setLogo({ url: String(data.url), alt: String(data.alt || "Funkedupshift") });
        }
      } catch {
        // Ignore; logo is optional.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandingContext.Provider value={{ logo }}>{children}</BrandingContext.Provider>;
};

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}

