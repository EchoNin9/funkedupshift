import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchWithAuthOptional } from "../utils/api";

interface LogoMeta {
  url: string;
  alt: string;
}

interface BrandingContextValue {
  logo: LogoMeta | null;
  /** Site name for header/footer. From API or fallback. Ready for multi-domain. */
  siteName: string;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const DEFAULT_SITE_NAME = "Funked Up Shift";

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logo, setLogo] = useState<LogoMeta | null>(null);
  const [siteName, setSiteName] = useState<string>(DEFAULT_SITE_NAME);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;

    let cancelled = false;
    const domain = typeof window !== "undefined" ? window.location.hostname : "";
    const url = domain ? `${apiBase}/branding/logo?domain=${encodeURIComponent(domain)}` : `${apiBase}/branding/logo`;

    (async () => {
      try {
        const resp = await fetchWithAuthOptional(url);
        if (!resp.ok) return;
        const contentType = resp.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) return;
        const data = await resp.json();
        if (cancelled) return;
        if (data && data.url) {
          setLogo({ url: String(data.url), alt: String(data.alt || DEFAULT_SITE_NAME) });
        }
        if (data?.siteName && typeof data.siteName === "string" && data.siteName.trim()) {
          setSiteName(data.siteName.trim());
        } else if (data?.alt && typeof data.alt === "string" && data.alt.trim()) {
          setSiteName(data.alt.trim());
        }
      } catch {
        // Ignore; logo is optional (avoids Unexpected token '<' when response is HTML).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandingContext.Provider value={{ logo, siteName }}>{children}</BrandingContext.Provider>;
};

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}

