import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth, hasRole } from "../../shell/AuthContext";
import { fetchWithAuthOptional } from "../../utils/api";
import { Alert, SkeletonGrid } from "../../components";

/* ── Domain from a URL (host without www), falls back to the raw string ── */
function domainOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

/* ── 5-star row from an average rating ── */
const Stars: React.FC<{ avg?: number }> = ({ avg }) => {
  const filled = Math.round(avg ?? 0);
  return (
    <span className="pop-stars" aria-label={avg ? `${avg.toFixed(1)} out of 5` : "unrated"}>
      {"★★★★★".slice(0, filled)}
      <span className="empty">{"★★★★★".slice(filled)}</span>
    </span>
  );
};

/* Cycle brutalist card-accent classes so the grid isn't monochrome. */
const CARD_ACCENTS = ["", "card-accent-n3", "card-accent-n2", "card-accent-n4"];

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
  const canManage = hasRole(user, "manager");
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
      <motion.header
        className="flex flex-wrap items-end justify-between gap-4"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-display font-extrabold uppercase tracking-tight text-text-primary">
            The Stash
          </h1>
          <p className="text-sm text-text-secondary">
            {sortedSites.length} curated {sortedSites.length === 1 ? "site" : "sites"} — rated and ready to raid.
          </p>
        </div>
        {canManage && (
          <Link to="/admin/websites" className="btn-primary">
            + Add site
          </Link>
        )}
      </motion.header>

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
            placeholder="Search the stash (title, URL, description)..."
            className="input-field pl-10"
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="input-field w-auto text-xs"
          >
            <option value="avgDesc">Stars (high first)</option>
            <option value="avgAsc">Stars (low first)</option>
            <option value="alphaAsc">Title A-Z</option>
            <option value="alphaDesc">Title Z-A</option>
          </select>
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
              className={`flex-shrink-0 rounded-full border-2 px-3.5 py-1 text-xs font-display font-extrabold uppercase tracking-tight transition-colors ${
                selectedCategoryIds.length === 0
                  ? "border-ink bg-accent text-ink"
                  : "border-border-default text-text-secondary hover:border-n3 hover:text-text-primary"
              }`}
            >
              All
            </button>
            {allCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className={`flex-shrink-0 rounded-full border-2 px-3.5 py-1 text-xs font-display font-extrabold uppercase tracking-tight transition-colors ${
                  selectedCategoryIds.includes(c.id)
                    ? "border-ink bg-accent text-ink"
                    : "border-border-default text-text-secondary hover:border-n3 hover:text-text-primary"
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
        <Alert variant="error" className="text-xs">{error}</Alert>
      )}

      {/* ── Skeleton loading ── */}
      {isLoading && <SkeletonGrid count={8} heights={["h-24","h-28","h-24","h-32","h-24","h-28"]} />}

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

      {/* ── Auto-fill grid of brutalist site cards ── */}
      {!isLoading && sortedSites.length > 0 && (
        <div className="grid gap-6 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {sortedSites.map((site, i) => {
            const title = site.title || site.url || site.PK || "Untitled";
            const logo = site.logoUrl;
            const domain = domainOf(site.url);
            const detailLink = `/websites/${encodeURIComponent(site.PK)}`;

            return (
              <motion.div
                key={site.PK}
                className="group flex flex-col"
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                custom={i}
              >
                <Link
                  to={detailLink}
                  className={`card ${CARD_ACCENTS[i % CARD_ACCENTS.length]} flex h-full w-full flex-col p-5 no-underline`}
                >
                  {/* Favicon / initial chip + title + domain */}
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-ink bg-surface-3 font-display text-lg font-extrabold text-text-primary">
                      {logo ? (
                        <img
                          src={logo}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        title.charAt(0).toUpperCase()
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-display text-base font-extrabold uppercase tracking-tight text-text-primary">
                        {title}
                      </h2>
                      {domain && (
                        <span className="block truncate font-mono text-xs text-text-tertiary">{domain}</span>
                      )}
                    </div>
                  </div>

                  {/* Blurb */}
                  {site.description && (
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-text-secondary">
                      {site.description}
                      {site.descriptionAiGenerated && (
                        <span className="ml-1 text-[11px] uppercase tracking-wide text-text-tertiary">AI summary</span>
                      )}
                    </p>
                  )}

                  {/* Tag pills */}
                  {site.categories && site.categories.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {site.categories.map((c) => (
                        <span key={c.id} className="pop-pill">{c.name}</span>
                      ))}
                    </div>
                  )}

                  {/* Divider + footer: stars + Open */}
                  <div className="mt-auto pt-4 border-t-2 border-border-subtle flex items-center justify-between gap-2">
                    {typeof site.averageRating === "number"
                      ? <Stars avg={site.averageRating} />
                      : <span className="text-xs text-text-tertiary">Unrated</span>}
                    <span className="inline-flex items-center gap-1 font-display text-xs font-extrabold uppercase tracking-tight text-accent transition-all group-hover:gap-2">
                      Open →
                    </span>
                  </div>
                </Link>

                {/* Rate (logged-in only) — kept out of the Link */}
                {canRate && (
                  <label className="mt-1.5 inline-flex items-center gap-1.5 px-1 text-[11px] text-text-tertiary">
                    <span>Rate:</span>
                    <select
                      className="input-field w-auto px-2 py-0.5 text-[11px]"
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
