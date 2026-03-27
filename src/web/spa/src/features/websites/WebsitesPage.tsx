import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../shell/AuthContext";
import { fetchWithAuthOptional } from "../../utils/api";

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
}

type SortKey = "avgDesc" | "avgAsc" | "alphaAsc" | "alphaDesc";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

const WebsitesPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(() => {
    const ids = searchParams.get("categoryIds");
    return ids ? ids.split(",").filter(Boolean) : [];
  });
  const [categoryMode, setCategoryMode] = useState<"and" | "or">(() => {
    const m = searchParams.get("categoryMode");
    return m === "or" ? "or" : "and";
  });
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [sort, setSort] = useState<SortKey>("avgDesc");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRate = !!user;
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [allCategories, setAllCategories] = useState<SiteCategory[]>([]);

  /* ── Fetch categories ── */
  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    let cancelled = false;
    fetchWithAuthOptional(`${apiBase}/categories`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load categories"))))
      .then((data: { categories?: { PK?: string; id?: string; name?: string }[] }) => {
        if (cancelled) return;
        const list = (data.categories ?? []).map((c) => ({
          id: c.PK || c.id || "",
          name: c.name || c.PK || ""
        }));
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setAllCategories(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const categoriesForDropdown = useMemo(() => {
    if (categoryMode === "or" && allCategories.length > 0) return allCategories;
    const fromSites = new Map<string, SiteCategory>();
    sites.forEach((s) =>
      (s.categories || []).forEach((c) => {
        if (c.id && !fromSites.has(c.id)) fromSites.set(c.id, c);
      })
    );
    const combined = [...allCategories];
    fromSites.forEach((c) => {
      if (!combined.some((x) => x.id === c.id)) combined.push(c);
    });
    combined.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return combined;
  }, [allCategories, categoryMode, sites]);

  const filteredCategoryOptions = useMemo(() => {
    return categoriesForDropdown.filter(
      (c) =>
        !selectedCategoryIds.includes(c.id) &&
        (!categorySearch.trim() || (c.name || "").toLowerCase().includes(categorySearch.toLowerCase()))
    );
  }, [categoriesForDropdown, selectedCategoryIds, categorySearch]);

  /* ── Sync search params ── */
  const hasActiveFilters = search.trim().length > 0 || selectedCategoryIds.length > 0;

  useEffect(() => {
    if (hasActiveFilters) {
      const next = new URLSearchParams();
      if (search.trim()) next.set("q", search.trim());
      if (selectedCategoryIds.length) {
        next.set("categoryIds", selectedCategoryIds.join(","));
        next.set("categoryMode", categoryMode);
      }
      setSearchParams(next, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [hasActiveFilters, search, selectedCategoryIds, categoryMode, setSearchParams]);

  /* ── Fetch sites on mount (all) and when filters change ── */
  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      setError("API URL not set. Deploy via CI or set window.API_BASE_URL in config.js.");
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "100");
        if (search.trim()) params.set("q", search.trim());
        if (selectedCategoryIds.length > 0) {
          params.set("categoryIds", selectedCategoryIds.join(","));
          params.set("categoryMode", categoryMode);
        }
        const resp = await fetchWithAuthOptional(`${apiBase}/sites?${params.toString()}`);
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const data = (await resp.json()) as { sites?: Site[] };
        if (cancelled) return;
        setSites(data.sites ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load sites.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [search, selectedCategoryIds, categoryMode]);

  /* ── Close category dropdown on outside click ── */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    }
    if (categoryDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [categoryDropdownOpen]);

  /* ── Sort ── */
  const sortedSites = useMemo(() => {
    const copy = [...sites];
    copy.sort((a, b) => {
      const titleA = (a.title || a.url || a.PK || "").toLowerCase();
      const titleB = (b.title || b.url || b.PK || "").toLowerCase();
      const avgA = typeof a.averageRating === "number" ? a.averageRating : 0;
      const avgB = typeof b.averageRating === "number" ? b.averageRating : 0;
      if (sort === "avgDesc") {
        if (avgB !== avgA) return avgB - avgA;
        return titleA.localeCompare(titleB);
      }
      if (sort === "avgAsc") {
        if (avgA !== avgB) return avgA - avgB;
        return titleA.localeCompare(titleB);
      }
      if (sort === "alphaAsc") return titleA.localeCompare(titleB);
      if (sort === "alphaDesc") return titleB.localeCompare(titleA);
      return 0;
    });
    return copy;
  }, [sites, sort]);

  /* ── Rate handler ── */
  const handleRate = async (siteId: string, rating: number) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const w = window as any;
    if (!w.auth || typeof w.auth.getAccessToken !== "function") return;
    const token: string | null = await new Promise((resolve) => {
      w.auth.getAccessToken((t: string | null) => resolve(t));
    });
    if (!token) return;
    await fetchWithAuthOptional(`${apiBase}/stars`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ siteId, rating })
    }).catch(() => {});
  };

  /* ── Toggle a category pill ── */
  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  /* ── Card animation variants ── */
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * 0.04, duration: 0.35, ease: "easeOut" }
    })
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Websites</h1>
        <p className="text-sm text-text-secondary">
          Browse curated sites, see ratings, and jump straight into the interesting corners of the internet.
        </p>
      </header>

      {/* ── Search bar + sort ── */}
      <form
        className="flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(search.trim());
        }}
      >
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites (title, URL, description)..."
            className="w-full rounded-full border border-border-default bg-surface-2 py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-full border border-border-default bg-surface-2 px-3 py-2.5 text-xs text-text-primary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="avgDesc">Stars (high first)</option>
            <option value="avgAsc">Stars (low first)</option>
            <option value="alphaAsc">Title A-Z</option>
            <option value="alphaDesc">Title Z-A</option>
          </select>
          <span className="hidden sm:inline text-xs text-text-tertiary whitespace-nowrap">
            {sortedSites.length} sites
          </span>
        </div>
      </form>

      {/* ── Category pills (horizontal scroll) ── */}
      {allCategories.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 overflow-x-auto scrollbar-thin pb-1">
            {/* "All" pill */}
            <button
              type="button"
              onClick={() => setSelectedCategoryIds([])}
              className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                selectedCategoryIds.length === 0
                  ? "bg-accent-500 text-white"
                  : "bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-2"
              }`}
            >
              All
            </button>
            {allCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  selectedCategoryIds.includes(c.id)
                    ? "bg-accent-500 text-white"
                    : "bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-2"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* AND/OR toggle + extra category search (for adding via dropdown) */}
          {selectedCategoryIds.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="inline-flex rounded-full border border-border-default bg-surface-1 p-0.5">
                <button
                  type="button"
                  onClick={() => setCategoryMode("and")}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    categoryMode === "and" ? "bg-accent-500 text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  AND
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryMode("or")}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    categoryMode === "or" ? "bg-accent-500 text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  OR
                </button>
              </div>
              {/* Category search dropdown (hidden behind a toggle for clean UI) */}
              <div ref={categoryDropdownRef} className="relative">
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  onFocus={() => setCategoryDropdownOpen(true)}
                  placeholder="Find category..."
                  className="w-40 rounded-full border border-border-default bg-surface-2 px-3 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                  autoComplete="off"
                />
                {categoryDropdownOpen && (
                  <div
                    className="absolute left-0 top-full z-10 mt-1 w-56 max-h-48 overflow-auto scrollbar-thin rounded-xl border border-border-default bg-surface-2 shadow-lg"
                    role="listbox"
                    aria-label="Category options"
                  >
                    {filteredCategoryOptions.length > 0 ? (
                      filteredCategoryOptions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="option"
                          onClick={() => {
                            setSelectedCategoryIds((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
                            setCategorySearch("");
                          }}
                          className="block w-full min-h-[40px] flex items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-3 transition-colors"
                        >
                          {c.name}
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-text-tertiary">
                        {categoriesForDropdown.length === 0 ? "No categories yet." : "No matches or all selected."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* ── Skeleton loading ── */}
      {isLoading && (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="break-inside-avoid mb-4">
              <div className="overflow-hidden rounded-xl bg-surface-2 border border-border-default">
                <div className="h-24 bg-surface-3 animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-surface-3 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-surface-3 animate-pulse" />
                  <div className="space-y-1">
                    <div className="h-3 w-full rounded bg-surface-3 animate-pulse" />
                    <div className="h-3 w-5/6 rounded bg-surface-3 animate-pulse" />
                  </div>
                  <div className="flex gap-1 pt-1">
                    <div className="h-5 w-14 rounded-full bg-surface-3 animate-pulse" />
                    <div className="h-5 w-10 rounded-full bg-surface-3 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && !error && sortedSites.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[280px] text-center">
          <svg className="h-12 w-12 text-text-tertiary mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          <p className="text-lg font-medium text-text-secondary">No websites found</p>
          <p className="text-sm text-text-tertiary mt-1">Try adjusting your search or category filters.</p>
        </div>
      )}

      {/* ── Masonry grid ── */}
      {!isLoading && sortedSites.length > 0 && (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4">
          {sortedSites.map((site, i) => {
            const title = site.title || site.url || site.PK || "Untitled";
            const logo = site.logoUrl;
            const detailLink = `/websites/${encodeURIComponent(site.PK)}`;

            return (
              <motion.div
                key={site.PK}
                className="break-inside-avoid mb-4 group"
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                custom={i}
              >
                <Link
                  to={detailLink}
                  className="block overflow-hidden rounded-xl bg-surface-2 border border-border-default hover:border-border-hover transition-all duration-200 hover:shadow-lg hover:shadow-black/20 group-hover:scale-[1.02]"
                >
                  {/* Banner header area with logo */}
                  <div className="h-24 bg-surface-3 flex items-center justify-center overflow-hidden">
                    {logo ? (
                      <img
                        src={logo}
                        alt=""
                        className="h-12 w-12 object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <svg className="h-10 w-10 text-text-tertiary/40" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                      </svg>
                    )}
                  </div>

                  {/* Card body */}
                  <div className="p-3 space-y-1.5">
                    <h2 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-400 transition-colors">
                      {title}
                    </h2>

                    {site.url && (
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate text-xs text-text-tertiary hover:text-accent-400 transition-colors"
                      >
                        {site.url}
                      </a>
                    )}

                    {site.description && (
                      <p className="text-xs text-text-secondary line-clamp-3">
                        {site.description}
                        {site.descriptionAiGenerated && (
                          <span className="ml-1 text-[11px] uppercase tracking-wide text-text-tertiary">
                            AI summary
                          </span>
                        )}
                      </p>
                    )}

                    {typeof site.averageRating === "number" && (
                      <div>
                        <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-amber-300 font-medium">
                          {site.averageRating.toFixed(1)} ★
                        </span>
                      </div>
                    )}

                    {site.categories && site.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {site.categories.map((c) => (
                          <span
                            key={c.id}
                            className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-text-secondary"
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>

                {/* Rate below card */}
                {canRate && (
                  <div className="mt-1.5 px-1">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
                      <span>Rate:</span>
                      <select
                        className="rounded-full border border-border-default bg-surface-2 px-2 py-0.5 text-[11px] text-text-primary focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (value >= 1 && value <= 5) {
                            handleRate(site.PK, value);
                          }
                        }}
                        defaultValue=""
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
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WebsitesPage;
