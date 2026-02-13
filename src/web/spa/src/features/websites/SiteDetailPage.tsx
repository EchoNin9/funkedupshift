import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuth, fetchWithAuthOptional } from "../../utils/api";

interface SiteCategory {
  id: string;
  name: string;
}

interface Site {
  PK: string;
  title?: string;
  url?: string;
  description?: string;
  descriptionAiGenerated?: boolean;
  averageRating?: number;
  logoUrl?: string;
  categories?: SiteCategory[];
  categoryIds?: string[];
  tags?: string[];
  scrapedContent?: string;
}

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const SiteDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canEdit = hasRole(user ?? null, "manager");
  const [site, setSite] = useState<Site | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || !id) {
      setError(id ? "API URL not set." : "Missing site id.");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("id", decodeURIComponent(id));
        const resp = await fetchWithAuthOptional(`${apiBase}/sites?${params.toString()}`);
        if (resp.status === 404) {
          if (!cancelled) setSite(null);
          return;
        }
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { site?: Site };
        if (cancelled) return;
        setSite(data.site ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load site.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!user || !site?.PK) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetchWithAuth(`${apiBase}/stars?siteId=${encodeURIComponent(site.PK)}`);
        if (cancelled) return;
        if (resp.ok) {
          const data = (await resp.json()) as { rating?: number };
          setUserRating(typeof data.rating === "number" ? data.rating : null);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user, site?.PK]);

  const handleRate = async (siteId: string, rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      await fetchWithAuth(`${apiBase}/stars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, rating })
      });
      setUserRating(rating);
    } catch {}
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Link
          to="/websites"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Websites
        </Link>
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="space-y-4">
        <Link
          to="/websites"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Websites
        </Link>
        <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-3 text-slate-200">
          {error || "Site not found."}
        </div>
      </div>
    );
  }

  const title = site.title || site.url || site.PK || "Untitled";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/websites"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Websites
        </Link>
        {canEdit && site && (
          <Link
            to={`/admin/sites/edit/${encodeURIComponent(site.PK)}`}
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Edit site
          </Link>
        )}
      </div>

      <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:p-6">
        <header className="flex flex-wrap gap-4">
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
            {site.logoUrl ? (
              <img
                src={site.logoUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-slate-50">{title}</h1>
            {typeof site.averageRating === "number" && (
              <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-sm text-amber-300">
                {site.averageRating.toFixed(1)}★ average
              </span>
            )}
            {site.url && (
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm text-slate-400 hover:text-slate-200"
              >
                {site.url}
              </a>
            )}
          </div>
        </header>

        {site.description && (
          <div className="mt-4">
            <p className="text-sm text-slate-300">
              {site.description}
              {site.descriptionAiGenerated && (
                <span className="ml-1 text-xs uppercase tracking-wide text-slate-500">
                  AI summary
                </span>
              )}
            </p>
          </div>
        )}

        {(site.categories?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {site.categories!.map((c) => (
              <span
                key={c.id}
                className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
              >
                {c.name}
              </span>
            ))}
          </div>
        )}

        {(site.tags?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {site.tags!.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {user && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {userRating !== null && (
              <span className="text-xs text-slate-400">Your rating: {userRating}★</span>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-slate-400">
              <span>Rate:</span>
              <select
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50"
                value={userRating ?? ""}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (value >= 1 && value <= 5) handleRate(site.PK, value);
                }}
              >
                <option value="">--</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </label>
          </div>
        )}

        {site.scrapedContent && (
          <section className="mt-6 border-t border-slate-800 pt-4">
            <h2 className="text-sm font-medium text-slate-400">About / Scraped content</h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-300">
                {site.scrapedContent}
              </pre>
            </div>
          </section>
        )}
      </article>
    </div>
  );
};

export default SiteDetailPage;
