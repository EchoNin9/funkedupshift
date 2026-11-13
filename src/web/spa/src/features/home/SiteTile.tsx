import React from "react";
import { Link } from "react-router-dom";
import { Globe, Star } from "@phosphor-icons/react";

export interface LatestSite {
  PK: string;
  title?: string;
  url?: string;
  logoUrl?: string;
  averageRating?: number;
  createdAt?: string;
}

function domainOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

/** Compact site card, same footprint/visual language as AppCard: 42px logo tile, title, domain, optional rating. */
export function SiteTile({ site }: { site: LatestSite }) {
  const domain = domainOf(site.url);
  const title = site.title || domain || "Untitled site";
  const [logoFailed, setLogoFailed] = React.useState(false);
  const rating = typeof site.averageRating === "number" && site.averageRating > 0 ? site.averageRating : null;
  return (
    <Link
      to={`/websites/${encodeURIComponent(site.PK)}`}
      aria-label={`${title}${domain ? `, ${domain}` : ""}${rating ? `, rated ${rating.toFixed(1)} out of 5` : ""}`}
      className={
        "relative flex min-w-0 items-center gap-3.5 rounded-ds-lg border border-divider bg-surface-2 p-3.5 text-left " +
        "motion-safe:transition-[transform,border-color] motion-safe:duration-150 hover:border-border-strong motion-safe:hover:-translate-y-0.5 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      }
    >
      <span
        className="app-icon hue-teal shrink-0 overflow-hidden"
        style={{ width: 42, height: 42, borderRadius: 12 }}
        aria-hidden="true"
      >
        {site.logoUrl && !logoFailed ? (
          <img src={site.logoUrl} alt="" loading="lazy" onError={() => setLogoFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <Globe className="h-[22px] w-[22px]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-text-primary">{title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[13px] leading-[1.45] text-text-secondary">
          <span className="min-w-0 truncate">{domain}</span>
          {rating !== null && (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-text-primary">
              <Star className="h-3 w-3 text-hue-amber" weight="fill" aria-hidden="true" />
              {rating.toFixed(1)}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

export function SiteTileSkeleton() {
  return (
    <div className="flex items-center gap-3.5 rounded-ds-lg border border-divider bg-surface-2 p-3.5" aria-hidden="true">
      <span className="h-[42px] w-[42px] shrink-0 rounded-[12px] bg-surface-3 motion-safe:animate-pulse" />
      <span className="flex-1 space-y-2">
        <span className="block h-3.5 w-2/3 rounded bg-surface-3 motion-safe:animate-pulse" />
        <span className="block h-3 w-1/3 rounded bg-surface-3 motion-safe:animate-pulse" />
      </span>
    </div>
  );
}
