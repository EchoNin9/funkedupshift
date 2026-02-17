import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchWithAuthOptional } from "../utils/api";

interface LogoMeta {
  url: string;
  alt: string;
}

export const DEFAULT_HERO_TAGLINE = "Shared internet intelligence";
export const DEFAULT_HERO_HEADLINE = "Discover, rate, and enrich the sites that matter.";
export const DEFAULT_HERO_SUBTEXT =
  "A living index of websites, media, and experiments – curated by admins, enriched by everyone.";

interface BrandingContextValue {
  logo: LogoMeta | null;
  siteName: string;
  heroTagline: string;
  heroHeadline: string;
  heroSubtext: string;
  heroImageUrl: string | null;
  heroOpacity: number;
  refreshBranding: () => Promise<void>;
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
  const [heroTagline, setHeroTagline] = useState<string>(DEFAULT_HERO_TAGLINE);
  const [heroHeadline, setHeroHeadline] = useState<string>(DEFAULT_HERO_HEADLINE);
  const [heroSubtext, setHeroSubtext] = useState<string>(DEFAULT_HERO_SUBTEXT);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [heroOpacity, setHeroOpacity] = useState<number>(0.4);

  const fetchBranding = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;

    const domain = typeof window !== "undefined" ? window.location.hostname : "";
    const logoUrl = domain ? `${apiBase}/branding/logo?domain=${encodeURIComponent(domain)}` : `${apiBase}/branding/logo`;

    try {
      const [logoResp, heroResp] = await Promise.all([
        fetchWithAuthOptional(logoUrl),
        fetchWithAuthOptional(`${apiBase}/branding/hero`),
      ]);

      if (logoResp.ok) {
        const contentType = logoResp.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          const data = await logoResp.json();
          if (data && data.url) {
            setLogo({ url: String(data.url), alt: String(data.alt || DEFAULT_SITE_NAME) });
          }
          if (data?.siteName && typeof data.siteName === "string" && data.siteName.trim()) {
            setSiteName(data.siteName.trim());
          } else if (data?.alt && typeof data.alt === "string" && data.alt.trim()) {
            setSiteName(data.alt.trim());
          }
        }
      }

      if (heroResp.ok) {
        const contentType = heroResp.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          const data = await heroResp.json();
          if (data?.tagline != null) setHeroTagline(String(data.tagline));
          if (data?.headline != null) setHeroHeadline(String(data.headline));
          if (data?.subtext != null) setHeroSubtext(String(data.subtext));
          if (data?.imageUrl != null) setHeroImageUrl(String(data.imageUrl));
          if (typeof data?.opacity === "number") setHeroOpacity(data.opacity);
        }
      }
    } catch {
      // Ignore; branding is optional
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBranding().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [fetchBranding]);

  const refreshBranding = useCallback(async () => {
    await fetchBranding();
  }, [fetchBranding]);

  return (
    <BrandingContext.Provider
      value={{
        logo,
        siteName,
        heroTagline,
        heroHeadline,
        heroSubtext,
        heroImageUrl,
        heroOpacity,
        refreshBranding,
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
};

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}

