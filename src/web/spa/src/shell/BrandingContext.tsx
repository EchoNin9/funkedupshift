import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchWithAuthOptional } from "../utils/api";

interface LogoMeta {
  url: string;
  alt: string;
}

export const DEFAULT_HERO_TAGLINE = "Shared internet intelligence";
export const DEFAULT_HERO_HEADLINE = "Discover, rate, and enrich the sites that matter.";
export const DEFAULT_HERO_SUBTEXT =
  "A living index of websites, media, and experiments – curated by admins, enriched by everyone.";

export interface HeroMeta {
  tagline: string;
  headline: string;
  subtext: string;
  imageUrl: string | null;
  imageOpacity: number;
}

interface BrandingContextValue {
  logo: LogoMeta | null;
  /** Site name for header/footer. From API or fallback. Ready for multi-domain. */
  siteName: string;
  hero: HeroMeta;
  /** Refetch branding from API (e.g. after logo/alt update). */
  refreshBranding: () => void;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const DEFAULT_SITE_NAME = "Funked Up Shift";

const defaultHero: HeroMeta = {
  tagline: DEFAULT_HERO_TAGLINE,
  headline: DEFAULT_HERO_HEADLINE,
  subtext: DEFAULT_HERO_SUBTEXT,
  imageUrl: null,
  imageOpacity: 25,
};

const fetchBranding = async (
  setLogo: React.Dispatch<React.SetStateAction<LogoMeta | null>>,
  setSiteName: React.Dispatch<React.SetStateAction<string>>,
  setHero: React.Dispatch<React.SetStateAction<HeroMeta>>
) => {
  const apiBase = getApiBaseUrl();
  if (!apiBase) return;
  const domain = typeof window !== "undefined" ? window.location.hostname : "";
  const url = domain ? `${apiBase}/branding/logo?domain=${encodeURIComponent(domain)}` : `${apiBase}/branding/logo`;
  try {
    const resp = await fetchWithAuthOptional(url);
    if (!resp.ok) return;
    const contentType = resp.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) return;
    const data = await resp.json();
    if (data && data.url) {
      setLogo({ url: String(data.url), alt: String(data.alt || DEFAULT_SITE_NAME) });
    } else {
      setLogo(null);
    }
    if (data?.siteName && typeof data.siteName === "string" && data.siteName.trim()) {
      setSiteName(data.siteName.trim());
    } else if (data?.alt && typeof data.alt === "string" && data.alt.trim()) {
      setSiteName(data.alt.trim());
    } else {
      setSiteName(DEFAULT_SITE_NAME);
    }
    setHero({
      tagline: (data?.heroTagline && String(data.heroTagline).trim()) || DEFAULT_HERO_TAGLINE,
      headline: (data?.heroHeadline && String(data.heroHeadline).trim()) || DEFAULT_HERO_HEADLINE,
      subtext: (data?.heroSubtext && String(data.heroSubtext).trim()) || DEFAULT_HERO_SUBTEXT,
      imageUrl: data?.heroImageUrl && String(data.heroImageUrl).trim() ? String(data.heroImageUrl) : null,
      imageOpacity:
        typeof data?.heroImageOpacity === "number"
          ? data.heroImageOpacity
          : typeof data?.heroImageOpacity === "string"
            ? parseInt(data.heroImageOpacity, 10) || defaultHero.imageOpacity
            : defaultHero.imageOpacity,
    });
  } catch {
    // Ignore; logo is optional (avoids Unexpected token '<' when response is HTML).
  }
};

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logo, setLogo] = useState<LogoMeta | null>(null);
  const [siteName, setSiteName] = useState<string>(DEFAULT_SITE_NAME);
  const [hero, setHero] = useState<HeroMeta>(defaultHero);

  const refreshBranding = React.useCallback(() => {
    fetchBranding(setLogo, setSiteName, setHero);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;

    (async () => {
      await fetchBranding(setLogo, setSiteName, setHero);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandingContext.Provider value={{ logo, siteName, hero, refreshBranding }}>{children}</BrandingContext.Provider>;
};

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}

